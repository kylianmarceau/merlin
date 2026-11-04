#include <atomic>

#include "base/command_line.h"
#include "base/files/file_util.h"
#include "base/files/scoped_temp_dir.h"
#include "base/strings/string_number_conversions.h"
#include "base/test/run_until.h"
#include "base/test/scoped_feature_list.h"
#include "base/test/test_future.h"
#include "base/threading/thread_restrictions.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/merlin_adblock/cache.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/merlin_adblock/updater.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_destroyer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/browserctl_server.h"
#include "chrome/browser/ui/modal_browser/config_file.h"
#include "chrome/browser/ui/modal_browser/merlin_adblock_button.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/modal_browser/workspace_store.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/common/chrome_features.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "chrome/test/base/in_process_browser_test.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "components/merlin_adblock/common/features.h"
#include "components/merlin_adblock/resources/bundled_data.h"
#include "content/public/browser/network_service_util.h"
#include "content/public/common/content_features.h"
#include "content/public/test/browser_test.h"
#include "content/public/test/browser_test_utils.h"
#include "content/public/test/prerender_test_util.h"
#include "content/public/test/test_utils.h"
#include "content/public/test/web_transport_simple_test_server.h"
#include "net/base/features.h"
#include "net/dns/mock_host_resolver.h"
#include "net/test/embedded_test_server/embedded_test_server.h"
#include "net/test/embedded_test_server/http_response.h"
#include "net/test/embedded_test_server/install_default_websocket_handlers.h"

namespace merlin_adblock {
class MerlinAdblockBrowserTest : public InProcessBrowserTest {
 public:
  MerlinAdblockBrowserTest() {
    // Merlin uses its native replacement toolbar. Chromium's generic browser
    // test setup must not wait for the hidden stock WebUI toolbar to paint.
    features_.InitWithFeatures({kMerlinAdblock, features::kBackForwardCache,
                                net::features::kEnableEarlyHintsOnHttp11},
                               {features::kWebUIToolbar});
    prerender_ = std::make_unique<content::test::PrerenderTestHelper>(
        base::BindRepeating(&MerlinAdblockBrowserTest::contents,
                            base::Unretained(this)));
  }
  void SetUpCommandLine(base::CommandLine* command_line) override {
    command_line->RemoveSwitch("disable-popup-blocking");
    command_line->RemoveSwitch("disable-back-forward-cache");
    base::ScopedAllowBlockingForTesting allow;
    ASSERT_TRUE(socket_dir_.CreateUniqueTempDir());
    command_line->AppendSwitchPath(
        modal_browser::kBrowserctlSocketSwitch,
        socket_dir_.GetPath().AppendASCII("control.sock"));
  }
  void SetUpInProcessBrowserTestFixture() override {
    base::ScopedAllowBlockingForTesting allow;
    ASSERT_TRUE(config_dir_.CreateUniqueTempDir());
    auto config = config_dir_.GetPath().AppendASCII("config.toml");
    ASSERT_TRUE(base::WriteFile(config,
                                "[options]\nmodal_browsing = false\nbrowserctl "
                                "= false\nrestore_session = false\n"));
    modal_browser::config_file::SetConfigPathForTesting(config);
    modal_browser::workspace_store::SetDirectoryForTesting(
        config_dir_.GetPath().AppendASCII("workspaces"));
  }
  void SetUpOnMainThread() override {
    host_resolver()->AddRule("*", "127.0.0.1");
    net::test_server::InstallDefaultWebSocketHandlers(embedded_test_server());
    embedded_test_server()->RegisterRequestMonitor(base::BindRepeating(
        [](std::atomic<int>* hits,
           const net::test_server::HttpRequest& request) {
          if (request.headers.contains("Upgrade") ||
              request.headers.contains("upgrade"))
            ++*hits;
        },
        &websocket_hits_));
    embedded_test_server()->RegisterRequestHandler(base::BindRepeating(
        &MerlinAdblockBrowserTest::Respond, base::Unretained(this)));
    ASSERT_TRUE(embedded_test_server()->Start());
  }

 protected:
  content::WebContents* contents() {
    return browser()->GetTabStripModel()->GetActiveWebContents();
  }
  Service* service() { return Service::Get(browser()->GetProfile()); }
  content::test::PrerenderTestHelper& prerender() { return *prerender_; }
  void Rules(std::string text, std::string resources = "[]") {
    base::test::TestFuture<bool> ready;
    service()->SetRulesForTesting(std::move(text), std::move(resources),
                                  ready.GetCallback());
    ASSERT_TRUE(ready.Get());
  }
  GURL Url(std::string path, std::string host = "news.test") {
    return embedded_test_server()->GetURL(host, path);
  }
  void ControlledPage() {
    ASSERT_TRUE(
        content::NavigateToURL(contents(), Url("/sw-page", "localhost")));
    EXPECT_EQ(true, content::EvalJs(contents(), R"JS((async()=>{
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
      return true;
    })())JS"));
  }
  content::EvalJsResult WorkerFetch(std::string kind, std::string path) {
    return content::EvalJs(contents(),
                           content::JsReplace(R"JS(new Promise(resolve=>{
      const shared=$1==='shared';
      const worker=shared?new SharedWorker('/fetch-worker.js'):new Worker('/fetch-worker.js');
      const port=shared?worker.port:worker;
      port.onmessage=event=>{resolve(event.data);if(shared)port.close();else worker.terminate();};
      if(shared)port.start();
      port.postMessage({url:$2,nested:$1==='nested'});
    }))JS",
                                              kind, path));
  }
  content::EvalJsResult Script(content::WebContents* page, std::string path) {
    return content::EvalJs(page, content::JsReplace(R"JS(new Promise(resolve=>{
      const script=document.createElement('script');script.src=$1;
      script.onload=()=>resolve('loaded');script.onerror=()=>resolve('blocked');
      document.head.append(script);
    }))JS",
                                                    path));
  }
  std::unique_ptr<net::test_server::HttpResponse> Respond(
      const net::test_server::HttpRequest& request) {
    auto response = std::make_unique<net::test_server::BasicHttpResponse>();
    response->set_code(net::HTTP_OK);
    response->set_content_type("text/html");
    if (request.relative_url.starts_with("/typed-")) {
      ++typed_hits_;
      uint32_t mask = 0;
      if (request.relative_url.starts_with("/typed-style"))
        mask = 1;
      if (request.relative_url.starts_with("/typed-image"))
        mask = 2;
      if (request.relative_url.starts_with("/typed-font"))
        mask = 4;
      if (request.relative_url.starts_with("/typed-media"))
        mask = 8;
      if (request.relative_url.starts_with("/typed-worker"))
        mask = 16;
      if (request.relative_url.starts_with("/typed-prefetch"))
        mask = 32;
      typed_mask_.fetch_or(mask);
      response->AddCustomHeader("Cache-Control", "no-store");
      response->set_content_type(mask == 1    ? "text/css"
                                 : mask == 8  ? "video/webm"
                                 : mask == 16 ? "application/javascript"
                                              : "text/plain");
      response->set_content(mask == 16 ? "postMessage('loaded');" : "fixture");
    } else if (request.relative_url == "/sw.js") {
      response->set_content_type("application/javascript");
      response->set_content(R"JS(
        self.addEventListener('install', event => event.waitUntil(
          caches.open('fixture').then(cache=>cache.put('/cached-ad',new Response('window.cachedAdReached=true;', {headers:{'Content-Type':'application/javascript'}}))).then(()=>self.skipWaiting())));
        self.addEventListener('activate', event=>event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', event=>{
          const path=new URL(event.request.url).pathname;
          if(path==='/synthetic-csp')event.respondWith(Promise.resolve(new Response(
            "<!doctype html><title>synthetic CSP</title><div id=body-marker>body preserved</div><script>window.inlineReached=true</script><script src='/allowed.js'></script>",
            {headers:{'Content-Type':'text/html','Content-Security-Policy':"script-src 'self'"}})));
          if(path==='/synthetic-ad')event.respondWith(Promise.resolve(new Response('window.syntheticAdReached=true;', {headers:{'Content-Type':'application/javascript'}})));
          if(path==='/cached-ad')event.respondWith(caches.match('/cached-ad'));
          if(path==='/replacement-ad')event.respondWith(Promise.resolve(new Response('window.workerWrongReplacement=true;', {headers:{'Content-Type':'application/javascript'}})));
          if(path==='/rewritten')event.respondWith(Promise.resolve(new Response('window.rewriteQuery='+JSON.stringify(new URL(event.request.url).search)+';', {headers:{'Content-Type':'application/javascript'}})));
          if(path==='/redirected-ad')event.respondWith(Promise.resolve(Response.redirect('/synthetic-ad')));
          if(path==='/redirected-replacement')event.respondWith(Promise.resolve(Response.redirect('/replacement-ad')));
          if(path==='/redirected-rewrite')event.respondWith(Promise.resolve(Response.redirect('/rewritten?tracking=1&keep=2')));
        });
      )JS");
    } else if (request.relative_url == "/sw-page") {
      response->set_content(
          "<!doctype html><title>Service worker fixture</title>");
    } else if (request.relative_url == "/cached-network-ad") {
      ++cached_network_hits_;
      response->set_content_type("application/javascript");
      response->AddCustomHeader("Cache-Control", "public,max-age=3600");
      response->set_content("window.cachedNetworkAdReached=true;");
    } else if (request.relative_url == "/synthetic-ad" ||
               request.relative_url == "/cached-ad") {
      ++blocked_hits_;
      response->set_content_type("application/javascript");
      response->set_content("window.networkAdReached=true;");
    } else if (request.relative_url == "/fetch-worker.js") {
      response->set_content_type("application/javascript");
      response->set_content(R"JS(
        function run(port) {
          port.onmessage=async event=>{
            if(event.data.nested) {
              const child=new Worker('/fetch-worker.js');
              child.onmessage=event=>{port.postMessage(event.data);child.terminate();};
              child.postMessage({url:event.data.url});
              return;
            }
            try {const response=await fetch(event.data.url);
              port.postMessage(await response.text());}
            catch {port.postMessage('blocked');}
          };
        }
        if('onconnect' in self)self.onconnect=event=>{
          run(event.ports[0]);event.ports[0].start();
        };else run(self);
      )JS");
    } else if (request.relative_url == "/worker.js") {
      response->set_content_type("application/javascript");
      response->set_content(R"JS(
        function run(port) {
          port.onmessage = event => {
            const ws = new WebSocket(event.data);
            ws.onerror = () => port.postMessage('blocked');
            ws.onopen = () => ws.send('echo');
            ws.onmessage = event => { port.postMessage(event.data); ws.close(); };
          };
        }
        if ('onconnect' in self) self.onconnect = event => { run(event.ports[0]); event.ports[0].start(); };
        else run(self);
      )JS");
    } else if (request.relative_url == "/rules") {
      ++update_hits_;
      if (request.headers.contains("Cookie") ||
          request.headers.contains("cookie"))
        update_sent_cookie_ = true;
      if (request.headers.contains("Referer") ||
          request.headers.contains("referer"))
        update_sent_referrer_ = true;
      response->set_content_type("text/plain");
      switch (update_mode_.load()) {
        case 1:
          response->set_content("<html>server error</html>");
          break;
        case 2:
          response->set_content(
              "||ads.test^$script\nnews.test##+js(missing-resource)");
          break;
        case 3:
          response->set_code(net::HTTP_INTERNAL_SERVER_ERROR);
          break;
        case 4:
          response->set_code(net::HTTP_FOUND);
          response->AddCustomHeader("Location",
                                    "https://unapproved.invalid/rules");
          break;
        default:
          response->set_content("||ads.test^$script");
          break;
      }
    } else if (request.relative_url == "/empty-rules") {
      ++optional_update_hits_;
      response->set_content_type("text/plain");
      response->set_content("! Brave desktop filters\n");
    } else if (request.relative_url == "/blocked.js") {
      ++blocked_hits_;
      response->set_content_type("application/javascript");
      response->set_content("window.adReached = true;");
    } else if (request.relative_url == "/allowed.js") {
      ++allowed_hits_;
      response->set_content_type("application/javascript");
      response->set_content("window.allowedReached = true;");
    } else if (request.relative_url == "/redirect" ||
               request.relative_url == "/popup-redirect") {
      response->set_code(net::HTTP_FOUND);
      response->AddCustomHeader("Location",
                                Url("/blocked.js", "ads.test").spec());
    } else if (request.relative_url == "/csp") {
      response->AddCustomHeader("Content-Security-Policy",
                                "script-src 'self'; img-src 'self'");
      response->set_content(
          "<!doctype html><title>CSP "
          "fixture</title><script>window.inlineReached = true</script><script "
          "src='/allowed.js'></script>");
    } else if (request.relative_url == "/srcdoc") {
      response->set_content(R"HTML(<!doctype html>
        <iframe srcdoc="<!doctype html><title>pending</title><script>document.title=String(globalThis.merlinFixture)</script><div class=sponsor>ad</div>"></iframe>
        <iframe sandbox srcdoc="<!doctype html><title>sandbox</title><script>document.title='bad'</script><div class=sponsor>ad</div>"></iframe>
      )HTML");
    } else if (request.relative_url == "/early") {
      ++early_hits_;
      response->set_content(
          "<!doctype "
          "html><script>document.title=String(globalThis.merlinFixture)</"
          "script><div class='sponsor'>ad</div>");
    } else if (request.relative_url == "/frames") {
      response->set_content("<!doctype html><iframe src='" +
                            Url("/early", "frame.test").spec() + "'></iframe>");
    } else {
      response->set_content(
          "<!doctype html><title>fixture</title><script src='" +
          Url("/blocked.js", "ads.test").spec() +
          "'></script><script src='/allowed.js'></script>");
    }
    return response;
  }
  std::atomic<int> cached_network_hits_{0};
  std::atomic<int> typed_hits_{0};
  std::atomic<uint32_t> typed_mask_{0};
  std::atomic<int> early_hits_{0};
  std::atomic<int> blocked_hits_{0};
  std::atomic<int> allowed_hits_{0};
  std::atomic<int> update_hits_{0};
  std::atomic<int> optional_update_hits_{0};
  std::atomic<int> websocket_hits_{0};
  std::atomic<int> update_mode_{0};
  std::atomic<bool> update_sent_cookie_{false};
  std::atomic<bool> update_sent_referrer_{false};
  void UpdateFixture(int mode, bool with_optional_source = false) {
    update_mode_ = mode;
    Bundle bundle;
    Source source;
    source.id = "fixture";
    source.text = "||old.test^$script";
    source.update_url = embedded_test_server()->GetURL("/rules");
    bundle.sources.push_back(std::move(source));
    if (with_optional_source) {
      base::ScopedAllowBlockingForTesting allow;
      auto catalog = LoadBundle({}, {}, {"brave"});
      for (auto& optional : catalog.sources) {
        if (optional.id == "brave-unbreak") {
          optional.update_url = embedded_test_server()->GetURL("/empty-rules");
          bundle.sources.push_back(std::move(optional));
          break;
        }
      }
      ASSERT_EQ(2u, bundle.sources.size());
      ASSERT_EQ(0u, bundle.sources.back().minimum_rules);
    }
    bundle.resources = "[]";
    service()->updater_for_testing()->SetBundleForTesting(std::move(bundle));
    service()->Refresh();
    ASSERT_TRUE(base::test::RunUntil(
        [&] { return !service()->updater_for_testing()->running(); }));
  }

 private:
  base::test::ScopedFeatureList features_;
  std::unique_ptr<content::test::PrerenderTestHelper> prerender_;
  base::ScopedTempDir socket_dir_;
  base::ScopedTempDir config_dir_;
};

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       NativeSubresourcesNeverReachServer) {
  Rules("||ads.test^$script");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_EQ(false, content::EvalJs(contents(), "!!window.adReached"));
  EXPECT_EQ(true, content::EvalJs(contents(), "!!window.allowedReached"));
  EXPECT_EQ(0, blocked_hits_.load());
  EXPECT_EQ(1, allowed_hits_.load());
  EXPECT_EQ(1u, service()->Blocked(contents()->GetPrimaryMainFrame()));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest, RedirectTargetsAreChecked) {
  Rules("||ads.test^$xmlhttprequest");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("blocked",
            content::EvalJs(
                contents(),
                "fetch('/redirect').then(()=> 'loaded', ()=> 'blocked')"));
  EXPECT_EQ(0, blocked_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ReplacementResourcesPreserveCors) {
  Rules(
      "||ads.test^$script,redirect=fixture.js\n||ads.test^$xmlhttprequest,"
      "redirect=fixture.js",
      R"([{"name":"fixture.js","kind":{"mime":"application/javascript"},"content":"d2luZG93LnN0dWJSZWFjaGVkID0gdHJ1ZTs="}])");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_EQ(true, content::EvalJs(contents(), "!!window.stubReached"));
  EXPECT_EQ(false, content::EvalJs(contents(), "!!window.adReached"));
  EXPECT_EQ(0, blocked_hits_.load());
  EXPECT_EQ(
      "cors-blocked",
      content::EvalJs(contents(),
                      content::JsReplace(
                          "fetch($1).then(()=> 'leaked',()=> 'cors-blocked')",
                          Url("/blocked.js", "ads.test"))));
  EXPECT_EQ(0, blocked_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       AdditiveCspPreservesSitePolicyAndExactException) {
  Rules("||news.test^$csp=script-src 'none'\nnews.test##.unused");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/csp")));
  EXPECT_EQ(false, content::EvalJs(contents(), "!!window.inlineReached"));
  EXPECT_EQ(false, content::EvalJs(contents(), "!!window.allowedReached"));
  EXPECT_EQ(0, allowed_hits_.load());
  service()->ToggleSite(Url("/csp"));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/csp")));
  EXPECT_EQ(false, content::EvalJs(contents(), "!!window.inlineReached"));
  EXPECT_EQ(true, content::EvalJs(contents(), "!!window.allowedReached"));
  EXPECT_EQ(1, allowed_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       WebSocketFramesAndWorkersCheckBeforeHandshake) {
  Rules("||ads.test^$websocket");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  const auto blocked = net::test_server::GetWebSocketURL(
      *embedded_test_server(), "ads.test", "/echo-with-no-extension");
  const auto allowed = net::test_server::GetWebSocketURL(
      *embedded_test_server(), "news.test", "/echo-with-no-extension");
  base::test::TestFuture<Decision> allowed_decision;
  service()->Check(allowed, Url("/early"), Url("/early"), "GET", 11,
                   allowed_decision.GetCallback());
  EXPECT_EQ(DecisionKind::kAllow, allowed_decision.Get().kind);
  const std::string direct = R"JS(new Promise(resolve => {
    const ws = new WebSocket($1); ws.onerror = () => resolve('blocked');
    ws.onopen = () => ws.send('echo'); ws.onmessage = e => { resolve(e.data); ws.close(); };
  }))JS";
  EXPECT_EQ("echo",
            content::EvalJs(contents(), content::JsReplace(direct, allowed)));
  EXPECT_EQ(1, websocket_hits_.load());
  EXPECT_EQ("blocked",
            content::EvalJs(contents(), content::JsReplace(direct, blocked)));
  EXPECT_EQ(1, websocket_hits_.load());
  for (bool shared : {false, true}) {
    const std::string worker =
        shared
            ? "new Promise(resolve=>{const w=new SharedWorker('/worker.js'); "
              "w.port.onmessage=e=>{resolve(e.data);w.port.close()};w.port."
              "start();w.port.postMessage($1)})"
            : "new Promise(resolve=>{const w=new "
              "Worker('/"
              "worker.js');w.onmessage=e=>{resolve(e.data);w.terminate()};w."
              "postMessage($1)})";
    EXPECT_EQ("blocked",
              content::EvalJs(contents(), content::JsReplace(worker, blocked)));
  }
  EXPECT_EQ(1, websocket_hits_.load());
  service()->ToggleSite(Url("/early"));
  EXPECT_EQ("echo",
            content::EvalJs(contents(), content::JsReplace(direct, blocked)));
  EXPECT_EQ(2, websocket_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       SharedWorkerUsesOwningOriginForException) {
  Rules("||ads.test^$websocket");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/frames")));
  service()->ToggleSite(Url("/frames"));
  auto* child = content::ChildFrameAt(contents(), 0);
  ASSERT_TRUE(child);
  const auto url = net::test_server::GetWebSocketURL(
      *embedded_test_server(), "ads.test", "/echo-with-no-extension");
  EXPECT_EQ("echo", content::EvalJs(
                        child, content::JsReplace(
                                   "new Promise(resolve=>{const w=new "
                                   "Worker('/"
                                   "worker.js');w.onmessage=e=>{resolve(e.data)"
                                   ";w.terminate()};w.postMessage($1)})",
                                   url)));
  EXPECT_EQ(
      "blocked",
      content::EvalJs(
          child, content::JsReplace(
                     "new Promise(resolve=>{const w=new "
                     "SharedWorker('/"
                     "worker.js');w.port.onmessage=e=>{resolve(e.data);w.port."
                     "close()};w.port.start();w.port.postMessage($1)})",
                     url)));
  EXPECT_EQ(1, websocket_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ScriptletBeforeFirstInlineScriptAndOopif) {
  Rules(
      "news.test,frame.test##+js(merlin-fixture)\nnews.test,frame.test##."
      "sponsor",
      R"([{"name":"merlin-fixture.js","kind":"template","content":"Z2xvYmFsVGhpcy5tZXJsaW5GaXh0dXJlID0gNDI7"}])");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("42", content::EvalJs(contents(), "document.title"));
  EXPECT_EQ(
      "none",
      content::EvalJs(
          contents(),
          "getComputedStyle(document.querySelector('.sponsor')).display"));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/frames")));
  auto* child = content::ChildFrameAt(contents(), 0);
  ASSERT_TRUE(child);
  EXPECT_NE(child->GetProcess(),
            contents()->GetPrimaryMainFrame()->GetProcess());
  EXPECT_EQ("42", content::EvalJs(child, "document.title"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ExactSiteExceptionAndGlobalRecovery) {
  Rules("||ads.test^$script");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_FALSE(service()->ToggleSite(Url("/page")));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_EQ(true, content::EvalJs(contents(), "!!window.adReached"));
  EXPECT_EQ(1, blocked_hits_.load());
  EXPECT_EQ(0u, service()->Blocked(contents()->GetPrimaryMainFrame()));
  EXPECT_TRUE(service()->EnabledFor(Url("/page", "sub.news.test")));
  service()->SetEnabled(false);
  ASSERT_TRUE(
      content::NavigateToURL(contents(), Url("/page", "sub.news.test")));
  EXPECT_EQ(true, content::EvalJs(contents(), "!!window.adReached"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       FailedGenerationKeepsPreviousRules) {
  Rules("||ads.test^$script");
  const uint64_t generation = service()->generation();
  base::test::TestFuture<bool> ready;
  service()->SetRulesForTesting("! no valid rules", "[]", ready.GetCallback());
  EXPECT_FALSE(ready.Get());
  EXPECT_EQ(generation, service()->generation());
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_EQ(0, blocked_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       DynamicGenericAndProceduralCosmetics) {
  Rules(
      "##.generic-ad\n##.allowed-ad\nnews.test#@#.allowed-ad\nnews.test##."
      "procedural:has-text(Sponsored)\nnews.test##.prune:remove()\nnews.test##."
      "styled:style(color: rgb(1, 2, "
      "3))\nnews.test##.strip:remove-attr(data-ad)");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("true,true,true,true,true,true", content::EvalJs(contents(), R"JS(
    new Promise(resolve => {
      const root = document.createElement('section');
      root.innerHTML = '<div class="generic-ad">Ad</div><div class="allowed-ad">Keep</div><div class="procedural">Sponsored</div><div class="prune">Remove</div><div class="styled">Styled</div><div class="strip" data-ad="yes">Stripped</div>';
      document.body.append(root);
      const deadline = performance.now() + 15000;
      const poll = () => {
        const done = [getComputedStyle(root.querySelector('.generic-ad')).display === 'none',
          getComputedStyle(root.querySelector('.allowed-ad')).display !== 'none',
          getComputedStyle(root.querySelector('.procedural')).display === 'none',
          !root.querySelector('.prune'),
          getComputedStyle(root.querySelector('.styled')).color === 'rgb(1, 2, 3)',
          !root.querySelector('.strip').hasAttribute('data-ad')];
        if (done.every(Boolean) || performance.now() > deadline) resolve(done.join(',')); else setTimeout(poll, 100);
      }; poll();
    })
  )JS"));
  EXPECT_EQ(
      "undefined",
      content::EvalJs(contents(), "typeof globalThis.__merlinAdblockTick"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       GenericHideExceptionKeepsSpecificRules) {
  Rules("##.generic-ad\nnews.test##.sponsor\n@@||news.test^$generichide");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ(true, content::EvalJs(contents(), R"JS(
    new Promise(resolve => {
      document.querySelector('.sponsor').classList.add('generic-ad');
      const div = document.createElement('div'); div.className = 'generic-ad'; document.body.append(div);
      setTimeout(() => resolve(getComputedStyle(div).display !== 'none' && getComputedStyle(document.querySelector('.sponsor')).display === 'none'), 1000);
    })
  )JS"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       BatchedCosmeticsPreserveSpecificityAndComplexSelectors) {
  std::string rules =
      "news.test##.grouped-ad\nnews.test###grouped-id\n"
      "news.test##[data-promotion]\nnews.test##.pseudo::before\n"
      "news.test##.first:first-child\nnews.test##.listed, .listed-other\n"
      "news.test##missing|div\n";
  for (unsigned i = 0; i < 512; ++i)
    rules += "news.test##.batch-" + base::NumberToString(i) + "\n";
  ASSERT_NO_FATAL_FAILURE(Rules(std::move(rules)));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("none,none,none,none,none,none,none,block",
            content::EvalJs(contents(), R"JS((()=>{
    document.body.innerHTML=`<style>
      .pseudo::before{content:'Ad';display:block}
      body .grouped-ad.keep{display:block!important}
    </style><section><div class="first">First</div></section>
    <div class="grouped-ad">Ad</div><div id="grouped-id">Ad</div>
    <div data-promotion>Ad</div><div class="listed">Ad</div>
    <div class="listed-other">Ad</div><div class="batch-511">Ad</div>
    <span class="pseudo">Kept text</span><div class="grouped-ad keep">Keep</div>`;
    const selectors=['.first','.grouped-ad:not(.keep)','#grouped-id',
      '[data-promotion]','.listed','.listed-other','.batch-511','.keep'];
    const actual=selectors.map(s=>getComputedStyle(document.querySelector(s)).display);
    if(getComputedStyle(document.querySelector('.pseudo'),'::before').display!=='none')return 'pseudo-element was not hidden';
    return actual.join(',');
  })())JS"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       BatchedAttributeValuesPreserveSyntaxAndSpecificity) {
  Rules(
      "news.test##a[href^=\"https://ads.test/\"]\n"
      "news.test##[data-campaign=\"summer:2026,launch\"]\n"
      "news.test##.escaped\\:ad\nnews.test##.escaped\\,ad\n"
      "news.test##[data-campaign=\"quoted\\\"value:ad\"]\n"
      "news.test##[data-note=\"colon:comma,value\"]::before\n"
      "news.test##[data-state=\"ad:active\"]:not(.allowed)\n");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("none,none,none,none,none,none,inline,block",
            content::EvalJs(contents(), R"JS((()=>{
    document.body.innerHTML=`<style>
      a.keep[href]{display:inline!important}
      [data-note]::before{content:'Ad';display:block}
    </style><a href="https://ads.test/a">Ad</a>
    <div data-campaign="summer:2026,launch">Ad</div>
    <div class="escaped:ad">Ad</div><div class="escaped,ad">Ad</div>
    <div id="quoted">Ad</div><div data-state="ad:active">Ad</div>
    <a class="keep" href="https://ads.test/keep">Keep</a>
    <div class="allowed" data-state="ad:active">Keep</div>
    <span data-note="colon:comma,value">Keep text</span>`;
    document.querySelector('#quoted').setAttribute('data-campaign','quoted"value:ad');
    if(getComputedStyle(document.querySelector('[data-note]'),'::before').display!=='none')return 'pseudo-element not hidden';
    return [...document.querySelectorAll('a,div')].map(e=>getComputedStyle(e).display).join(',');
  })())JS"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       IsolatedScriptletCannotModifyPageGlobals) {
  Rules(
      "news.test##+js(isolated-fixture)",
      R"([{"name":"isolated-fixture.js","kind":"template","world":"ISOLATED","content":"Z2xvYmFsVGhpcy5tZXJsaW5Jc29sYXRlZCA9IDg0OyBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2V0QXR0cmlidXRlKCdkYXRhLWlzb2xhdGVkJywgJ3llcycpOw=="}])");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("undefined",
            content::EvalJs(contents(), "typeof globalThis.merlinIsolated"));
  EXPECT_EQ(84, content::EvalJs(contents(), "globalThis.merlinIsolated",
                                content::EXECUTE_SCRIPT_DEFAULT_OPTIONS,
                                ISOLATED_WORLD_ID_MERLIN_ADBLOCK));
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(), "typeof globalThis.__merlinAdblockTick",
                           content::EXECUTE_SCRIPT_DEFAULT_OPTIONS,
                           ISOLATED_WORLD_ID_MERLIN_ADBLOCK) == "function";
  }));
  EXPECT_EQ(
      "undefined",
      content::EvalJs(contents(), "typeof globalThis.__merlinAdblockTick"));
  // At context creation the HTML element need not exist yet. The fixture's
  // page-global mutation proves execution in the requested world at that time.
}

IN_PROC_BROWSER_TEST_F(
    MerlinAdblockBrowserTest,
    PackagedMainAndIsolatedScriptletsRunBeforeInlineAndOnDomCreation) {
  Rules(
      "news.test##+js(set, merlinFixture, 42)\nnews.test##+js(set-attr, html, "
      "data-merlin, true)",
      ReadBundledAsset("resources.json"));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("42", content::EvalJs(contents(), "document.title"));
  EXPECT_EQ(true, content::EvalJs(contents(), R"JS(new Promise(resolve=>{
    const deadline=performance.now()+5000;
    const poll=()=>{const done=document.documentElement.getAttribute('data-merlin')==='true';
      if(done || performance.now()>deadline)resolve(done);else setTimeout(poll,50)};poll();
  }))JS"));
}

IN_PROC_BROWSER_TEST_F(
    MerlinAdblockBrowserTest,
    ControlsWorkWithModalBrowsingDisabledAndRejectStaleMenus) {
  Rules("||ads.test^$script");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  auto* controller = modal_browser::ModalBrowserController::From(browser());
  ASSERT_TRUE(controller);
  // The toolbar no longer shows the shield; its per-site menu is still the
  // control site information will offer.
  auto owned_button = std::make_unique<modal_browser::MerlinAdblockButton>(
      browser(), base::DoNothing());
  auto* button = owned_button.get();
  button->Update();
  EXPECT_TRUE(button->GetVisible());
  auto* menu = button->BuildMenuForTesting();
  const int toggle = menu->GetCommandIdAt(1);
  EXPECT_TRUE(button->IsCommandIdChecked(toggle));
  button->ExecuteCommand(toggle, 0);
  EXPECT_FALSE(service()->EnabledFor(Url("/page")));
  EXPECT_TRUE(service()->EnabledFor(Url("/page", "sub.news.test")));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early", "other.test")));
  button->ExecuteCommand(toggle, 0);
  EXPECT_TRUE(service()->EnabledFor(Url("/early", "other.test")));
  controller->RunBrowserCommand("adblock", "off");
  EXPECT_EQ(Readiness::kDisabled, service()->readiness());
  controller->RunBrowserCommand("adblock", "on");
  EXPECT_EQ(Readiness::kReady, service()->readiness());
  ASSERT_TRUE(content::NavigateToURL(
      contents(), GURL("chrome://merlin-settings/#adblock")));
  EXPECT_TRUE(content::ExecJs(
      contents(), "document.getElementById('adblock-enabled').click()"));
  EXPECT_TRUE(base::test::RunUntil(
      [&] { return service()->readiness() == Readiness::kDisabled; }));
  EXPECT_TRUE(content::ExecJs(
      contents(), "document.getElementById('adblock-enabled').click()"));
  EXPECT_TRUE(base::test::RunUntil(
      [&] { return service()->readiness() == Readiness::kReady; }));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ListRefreshOmitsCookiesAndPublishesValidGeneration) {
  Rules("||old.test^$script");
  ASSERT_TRUE(content::SetCookie(browser()->GetProfile(),
                                 embedded_test_server()->GetURL("/rules"),
                                 "private_cookie=secret"));
  const auto generation = service()->generation();
  UpdateFixture(0);
  EXPECT_EQ("Filter lists updated", service()->UpdateStatus());
  EXPECT_EQ(generation + 1, service()->generation());
  EXPECT_EQ(1, update_hits_.load());
  EXPECT_FALSE(update_sent_cookie_.load());
  EXPECT_FALSE(update_sent_referrer_.load());
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_EQ(0, blocked_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       CommentOnlyCatalogSourceDoesNotAbortTheRefresh) {
  Rules("||old.test^$script");
  const auto generation = service()->generation();
  UpdateFixture(0, true);
  EXPECT_EQ("Filter lists updated", service()->UpdateStatus());
  EXPECT_EQ(generation + 1, service()->generation());
  EXPECT_EQ(1, optional_update_hits_.load());
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_EQ(0, blocked_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       FailedListRefreshRetainsWorkingGeneration) {
  Rules("||ads.test^$script");
  const auto generation = service()->generation();
  for (int mode : {1, 2, 3, 4}) {
    UpdateFixture(mode);
    EXPECT_EQ(generation, service()->generation());
    EXPECT_EQ(Readiness::kReady, service()->readiness());
    ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
    EXPECT_EQ(0, blocked_hits_.load());
  }
  EXPECT_EQ(4, update_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       OfflineCacheIntegrityAndPreviousSnapshotRecovery) {
  EXPECT_EQ(48u, SourceExpiryHours("! Expires: 2 days\n", 6));
  EXPECT_EQ(1u, SourceExpiryHours("! Expires: 1 hour\r\n", 6));
  EXPECT_EQ(168u, SourceExpiryHours("! Expires: 999 days\n", 6));
  EXPECT_EQ(6u, SourceExpiryHours("! Expires: invalid\n", 6));
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return service()->readiness() == Readiness::kReady; }));
  const auto path = browser()
                        ->GetProfile()
                        ->GetPath()
                        .AppendASCII("MerlinAdblock")
                        .AppendASCII("current");
  base::ScopedAllowBlockingForTesting allow;
  ASSERT_TRUE(base::PathExists(path));
  auto cached = LoadBundle(path, path, service()->Groups());
  ASSERT_TRUE(cached.from_cache);
  ASSERT_FALSE(cached.cache.empty());
  const auto identity = cached.key;
  ASSERT_TRUE(
      SaveBundleCache(cached));  // Retains a complete previous snapshot.
  ASSERT_TRUE(base::WriteFile(path, "truncated cache"));
  auto recovered = LoadBundle(path, path, service()->Groups());
  EXPECT_TRUE(recovered.from_cache);
  EXPECT_EQ(identity, recovered.key);
  ASSERT_TRUE(
      base::WriteFile(path.AddExtensionASCII("previous"), "corrupt previous"));
  auto bundled = LoadBundle(path, path, service()->Groups());
  EXPECT_FALSE(bundled.from_cache);
  EXPECT_EQ(18u, bundled.sources.size());
  EXPECT_EQ(identity, bundled.key);
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       PrivatePreferencesAndSharedEngineStayIsolated) {
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return service()->readiness() == Readiness::kReady; }));
  base::ScopedAllowBlockingForTesting allow;
  const auto cache_path = browser()
                              ->GetProfile()
                              ->GetPath()
                              .AppendASCII("MerlinAdblock")
                              .AppendASCII("current");
  std::string normal_cache;
  ASSERT_TRUE(base::ReadFileToString(cache_path, &normal_cache));
  auto* private_profile = browser()->GetProfile()->GetPrimaryOTRProfile(true);
  auto* private_service = Service::Get(private_profile);
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return private_service->readiness() == Readiness::kReady; }));
  EXPECT_EQ(service()->evaluator_for_testing(),
            private_service->evaluator_for_testing());
  EXPECT_EQ(nullptr, private_service->updater_for_testing());
  EXPECT_FALSE(private_service->ToggleSite(Url("/page")));
  EXPECT_TRUE(service()->EnabledFor(Url("/page")));
  const auto before = private_service->generation();
  private_service->SetGroups({"easyprivacy"});
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return private_service->generation() > before; }));
  EXPECT_EQ(4u, service()->Groups().size());
  EXPECT_NE(service()->evaluator_for_testing(),
            private_service->evaluator_for_testing());
  std::string after;
  ASSERT_TRUE(base::ReadFileToString(cache_path, &after));
  EXPECT_EQ(normal_cache, after);
}
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ServiceWorkerSyntheticAndCachedScriptsAreFiltered) {
  Rules("||never.test^$script");
  const auto page = Url("/sw-page", "localhost");
  ASSERT_TRUE(content::NavigateToURL(contents(), page));
  EXPECT_EQ(true, content::EvalJs(contents(), R"JS((async()=>{
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    return true;
  })())JS"));
  const std::string load = R"JS(new Promise(resolve=>{
    const script=document.createElement('script');script.src=$1;
    script.onload=()=>resolve('loaded');script.onerror=()=>resolve('blocked');
    document.head.append(script);
  }))JS";
  EXPECT_EQ("loaded", content::EvalJs(contents(), content::JsReplace(
                                                      load, "/synthetic-ad")));
  EXPECT_EQ("loaded", content::EvalJs(contents(),
                                      content::JsReplace(load, "/cached-ad")));
  EXPECT_EQ(true,
            content::EvalJs(
                contents(),
                "!!window.syntheticAdReached && !!window.cachedAdReached"));
  EXPECT_EQ(0, blocked_hits_.load());
  Rules("/synthetic-ad$script\n/cached-ad$script");
  ASSERT_TRUE(content::NavigateToURL(contents(), page));
  EXPECT_EQ("blocked", content::EvalJs(contents(), content::JsReplace(
                                                       load, "/synthetic-ad")));
  EXPECT_EQ("blocked", content::EvalJs(contents(),
                                       content::JsReplace(load, "/cached-ad")));
  EXPECT_EQ(false,
            content::EvalJs(
                contents(),
                "!!window.syntheticAdReached || !!window.cachedAdReached"));
  EXPECT_EQ(0, blocked_hits_.load());
}
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ServiceWorkerClaimAfterLoadStillFiltersSyntheticAds) {
  // The document commits uncontrolled, so background fetches start without a
  // throttle. Once the worker claims it, the controller-change hook must make
  // later requests go through the policy before the worker answers them.
  Rules("/synthetic-ad$script\n/cached-ad$script");
  ASSERT_TRUE(
      content::NavigateToURL(contents(), Url("/sw-page", "localhost")));
  EXPECT_EQ(true, content::EvalJs(contents(), R"JS((async()=>{
    if(navigator.serviceWorker.controller)return false;
    const changed=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    await navigator.serviceWorker.register('/sw.js');
    await changed;
    return !!navigator.serviceWorker.controller;
  })())JS"));
  const std::string load = R"JS(new Promise(resolve=>{
    const script=document.createElement('script');script.src=$1;
    script.onload=()=>resolve('loaded');script.onerror=()=>resolve('blocked');
    document.head.append(script);
  }))JS";
  EXPECT_EQ("blocked", content::EvalJs(contents(), content::JsReplace(
                                                       load, "/synthetic-ad")));
  EXPECT_EQ(false, content::EvalJs(contents(), "!!window.syntheticAdReached"));
}
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       PopupRulesBlockBeforeCreationAndKeepLegitimateWindows) {
  Rules("||ads.test^$popup");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  auto* original = contents();
  EXPECT_EQ(true,
            content::EvalJs(
                original, content::JsReplace("window.open($1,'_blank')===null",
                                             Url("/blocked.js", "ads.test"))));
  EXPECT_EQ(0, blocked_hits_.load());
  EXPECT_EQ(1u, service()->Blocked(original->GetPrimaryMainFrame()));
  content::WebContentsAddedObserver added;
  EXPECT_EQ(false,
            content::EvalJs(original, content::JsReplace(
                                          "window.fixtureChild=window.open($1,'"
                                          "_blank');window.fixtureChild===null",
                                          Url("/early", "signin.test"))));
  auto* child = added.GetWebContents();
  ASSERT_TRUE(content::WaitForLoadStop(child));
  EXPECT_EQ(Url("/early", "signin.test"), child->GetLastCommittedURL());
  // Direct user navigation retains the explicit no-strict-blocking policy.
  ASSERT_TRUE(content::NavigateToURL(original, Url("/blocked.js", "ads.test")));
  EXPECT_EQ(1, blocked_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       PopupRedirectAndAboutBlankChainsAreChecked) {
  Rules("||ads.test^$popup");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  auto* original = contents();
  {
    content::WebContentsAddedObserver added;
    ASSERT_TRUE(content::ExecJs(
        original, "window.fixtureChild=window.open('about:blank','_blank')"));
    auto* child = added.GetWebContents();
    auto child_weak = child->GetWeakPtr();
    ASSERT_TRUE(content::ExecJs(
        child, content::JsReplace("location.href=$1",
                                  Url("/blocked.js", "ads.test"))));
    EXPECT_TRUE(base::test::RunUntil([&] { return !child_weak; }));
    EXPECT_EQ(0, blocked_hits_.load());
  }
  EXPECT_EQ(true, content::EvalJs(original,
                                  content::JsReplace(R"JS(
    new Promise(resolve=>{
      const child=window.open($1,'_blank');const deadline=performance.now()+5000;
      const poll=()=>{const closed=!child||child.closed;if(closed||performance.now()>deadline)resolve(closed);else setTimeout(poll,50)};poll();
    })
  )JS",
                                                     Url("/popup-redirect"))));
  EXPECT_EQ(0, blocked_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       PopunderRedirectIsCancelledWithoutLosingTheOpener) {
  Rules("||ads.test^$popunder,domain=desired.test");
  const auto original_url = Url("/early");
  ASSERT_TRUE(content::NavigateToURL(contents(), original_url));
  auto* original = contents();
  content::WebContentsAddedObserver added;
  ASSERT_TRUE(content::ExecJs(
      original,
      content::JsReplace("window.fixtureChild=window.open($1,'_blank')",
                         Url("/early", "desired.test"))));
  auto* child = added.GetWebContents();
  ASSERT_TRUE(content::WaitForLoadStop(child));
  ASSERT_TRUE(content::ExecJs(
      original,
      content::JsReplace("location.href=$1", Url("/blocked.js", "ads.test")),
      content::EXECUTE_SCRIPT_NO_USER_GESTURE));
  EXPECT_TRUE(base::test::RunUntil(
      [&] { return service()->Blocked(original->GetPrimaryMainFrame()) > 0; }));
  EXPECT_EQ(original_url, original->GetLastCommittedURL());
  EXPECT_EQ(Url("/early", "desired.test"), child->GetLastCommittedURL());
  EXPECT_EQ(0, blocked_hits_.load());
  ASSERT_TRUE(content::NavigateToURL(original, Url("/blocked.js", "ads.test")));
  EXPECT_EQ(1, blocked_hits_.load());
}
IN_PROC_BROWSER_TEST_F(
    MerlinAdblockBrowserTest,
    ServiceWorkerReplacementsAndRewritesRetainTypedDecisions) {
  Rules(
      "/replacement-ad$script,redirect=fixture.js\n/"
      "rewritten$script,removeparam=tracking",
      R"([{"name":"fixture.js","kind":{"mime":"application/javascript"},"content":"d2luZG93LnN0dWJSZWFjaGVkID0gdHJ1ZTs="}])");
  ControlledPage();
  EXPECT_EQ("loaded", Script(contents(), "/replacement-ad"));
  EXPECT_EQ(true,
            content::EvalJs(
                contents(),
                "!!window.stubReached && !window.workerWrongReplacement"));
  EXPECT_EQ("loaded", Script(contents(), "/rewritten?tracking=1&keep=2"));
  EXPECT_EQ("?keep=2", content::EvalJs(contents(), "window.rewriteQuery"));
  EXPECT_TRUE(content::ExecJs(
      contents(), "window.stubReached=false;window.rewriteQuery=''"));
  EXPECT_EQ("loaded", Script(contents(), "/redirected-replacement"));
  EXPECT_EQ(true,
            content::EvalJs(
                contents(),
                "!!window.stubReached && !window.workerWrongReplacement"));
  EXPECT_EQ("loaded", Script(contents(), "/redirected-rewrite"));
  EXPECT_EQ("?keep=2", content::EvalJs(contents(), "window.rewriteQuery"));
}

IN_PROC_BROWSER_TEST_F(
    MerlinAdblockBrowserTest,
    ServiceWorkerRedirectTargetsAndReplacementCorsAreChecked) {
  Rules(
      "/synthetic-ad$script\n||ads.test^$xmlhttprequest,redirect=fixture.js",
      R"([{"name":"fixture.js","kind":{"mime":"application/javascript"},"content":"d2luZG93LnN0dWJSZWFjaGVkID0gdHJ1ZTs="}])");
  ControlledPage();
  EXPECT_EQ("blocked", Script(contents(), "/redirected-ad"));
  EXPECT_EQ(false, content::EvalJs(contents(), "!!window.syntheticAdReached"));
  EXPECT_EQ(
      "cors-blocked",
      content::EvalJs(contents(),
                      content::JsReplace(
                          "fetch($1).then(()=> 'leaked',()=> 'cors-blocked')",
                          Url("/replacement-ad", "ads.test"))));
  EXPECT_EQ(0, blocked_hits_.load());
  EXPECT_EQ(2u, service()->Blocked(contents()->GetPrimaryMainFrame()));
}
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       InheritedSrcdocUsesBrowserPolicyAndRespectsSandbox) {
  Rules(
      "news.test##+js(merlin-fixture)\nnews.test##.sponsor",
      R"([{"name":"merlin-fixture.js","kind":"template","content":"Z2xvYmFsVGhpcy5tZXJsaW5GaXh0dXJlID0gNDI7"}])");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/srcdoc")));
  auto* normal = content::ChildFrameAt(contents(), 0);
  auto* sandboxed = content::ChildFrameAt(contents(), 1);
  ASSERT_TRUE(normal);
  ASSERT_TRUE(sandboxed);
  EXPECT_EQ("42", content::EvalJs(normal, "document.title"));
  EXPECT_EQ(
      "none",
      content::EvalJs(
          normal,
          "getComputedStyle(document.querySelector('.sponsor')).display"));
  EXPECT_EQ("sandbox", content::EvalJs(sandboxed, "document.title"));
  EXPECT_EQ("undefined",
            content::EvalJs(sandboxed, "typeof globalThis.merlinFixture"));
  EXPECT_EQ(
      "none",
      content::EvalJs(
          sandboxed,
          "getComputedStyle(document.querySelector('.sponsor')).display"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       BlockedJavascriptSettingDoesNotReceiveScriptlets) {
  Rules(
      "news.test##+js(merlin-fixture)",
      R"([{"name":"merlin-fixture.js","kind":"template","content":"Z2xvYmFsVGhpcy5tZXJsaW5GaXh0dXJlID0gNDI7"}])");
  HostContentSettingsMapFactory::GetForProfile(browser()->GetProfile())
      ->SetContentSettingDefaultScope(Url("/early"), Url("/early"),
                                      ContentSettingsType::JAVASCRIPT,
                                      CONTENT_SETTING_BLOCK);
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("undefined",
            content::EvalJs(contents(), "typeof globalThis.merlinFixture"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       NativeProtectionCannotGrantPopupWithoutActivation) {
  Rules("||ads.test^$popup");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ(true, content::EvalJs(
                      contents(),
                      content::JsReplace("window.open($1,'_blank')===null",
                                         Url("/early", "signin.test")),
                      content::EXECUTE_SCRIPT_NO_USER_GESTURE));
}
IN_PROC_BROWSER_TEST_F(
    MerlinAdblockBrowserTest,
    InitialBlankScriptContextInheritsWithoutBypassingSandbox) {
  Rules(
      "news.test##+js(merlin-fixture)\nnews.test##.sponsor",
      R"([{"name":"merlin-fixture.js","kind":"template","content":"Z2xvYmFsVGhpcy5tZXJsaW5GaXh0dXJlID0gNDI7"}])");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("42", content::EvalJs(contents(), R"JS(
    const frame=document.createElement('iframe');document.body.append(frame);
    frame.contentWindow.eval('document.title=String(globalThis.merlinFixture)');
    frame.contentDocument.title;
  )JS"));
  EXPECT_TRUE(content::ExecJs(contents(), R"JS(
    const sandboxed=document.createElement('iframe');sandboxed.setAttribute('sandbox','allow-same-origin');
    document.body.append(sandboxed);sandboxed.contentDocument.body.innerHTML='<div class="sponsor">ad</div>';
  )JS"));
  auto* sandboxed = content::ChildFrameAt(contents(), 1);
  ASSERT_TRUE(sandboxed);
  EXPECT_EQ("undefined",
            content::EvalJs(sandboxed, "typeof globalThis.merlinFixture"));
  EXPECT_EQ(
      "none",
      content::EvalJs(
          sandboxed,
          "getComputedStyle(document.querySelector('.sponsor')).display"));
}
IN_PROC_BROWSER_TEST_F(
    MerlinAdblockBrowserTest,
    InvalidSerializedCacheBuildsBundledFallbackOnOwnerSequence) {
  Bundle bundle;
  bundle.from_cache = true;
  bundle.sources.push_back({"fixture", "||cached.test^$script", 0});
  bundle.bundled_sources.push_back({"fixture", "||fallback.test^$script", 0});
  bundle.resources = "[]";
  bundle.cache = "invalid serialized engine";
  auto evaluator = Evaluator::Acquire("invalid-cache-fixture");
  base::test::TestFuture<bool> installed;
  evaluator->Install(std::move(bundle), installed.GetCallback());
  ASSERT_TRUE(installed.Get());
  base::test::TestFuture<Decision> fallback;
  evaluator->Check(GURL("https://fallback.test/ad"), GURL("https://news.test/"),
                   "GET", 3, fallback.GetCallback());
  EXPECT_EQ(DecisionKind::kBlock, fallback.Get().kind);
  base::test::TestFuture<Decision> previous;
  evaluator->Check(GURL("https://cached.test/ad"), GURL("https://news.test/"),
                   "GET", 3, previous.GetCallback());
  EXPECT_EQ(DecisionKind::kAllow, previous.Get().kind);
}
}  // namespace merlin_adblock

namespace merlin_adblock {
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       BackForwardCacheRestoresCosmeticsWithoutReinjection) {
  Rules(
      "news.test##.sponsor\nnews.test##+js(merlin-fixture)",
      R"([{"name":"merlin-fixture.js","kind":"template","content":"Z2xvYmFsVGhpcy5tZXJsaW5GaXh0dXJlID0gNDI7"}])");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("42", content::EvalJs(contents(), "document.title"));
  content::RenderFrameHostWrapper original(contents()->GetPrimaryMainFrame());
  ASSERT_TRUE(content::ExecJs(contents(), "globalThis.merlinFixture=43"));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early", "other.test")));
  ASSERT_FALSE(original.IsDestroyed());
  EXPECT_EQ(content::RenderFrameHost::LifecycleState::kInBackForwardCache,
            original->GetLifecycleState());
  ASSERT_TRUE(content::HistoryGoBack(contents()));
  EXPECT_EQ(original.get(), contents()->GetPrimaryMainFrame());
  EXPECT_EQ(43, content::EvalJs(contents(), "globalThis.merlinFixture"));
  EXPECT_EQ(2, early_hits_.load());
  EXPECT_EQ("none", content::EvalJs(contents(), R"JS((async()=>{
    const ad=document.createElement('div');ad.className='sponsor';
    document.body.append(ad);
    await new Promise(resolve=>setTimeout(resolve,600));
    return getComputedStyle(ad).display;
  })())JS"));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       PrerenderActivatesPreparedDocumentWithoutReinjection) {
  Rules(
      "localhost##.sponsor\nlocalhost##+js(merlin-fixture)",
      R"([{"name":"merlin-fixture.js","kind":"template","content":"Z2xvYmFsVGhpcy5tZXJsaW5GaXh0dXJlID0gNDI7"}])");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/sw-page", "localhost")));
  const GURL target = Url("/early", "localhost");
  const auto id = prerender().AddPrerender(target);
  auto* frame = prerender().GetPrerenderedMainFrameHost(id);
  ASSERT_TRUE(frame);
  EXPECT_EQ("42", content::EvalJs(frame, "document.title"));
  ASSERT_TRUE(content::ExecJs(frame, "globalThis.merlinFixture=43"));
  prerender().NavigatePrimaryPage(target);
  EXPECT_EQ(frame, contents()->GetPrimaryMainFrame());
  EXPECT_EQ(43, content::EvalJs(contents(), "globalThis.merlinFixture"));
  EXPECT_EQ(
      "none",
      content::EvalJs(
          contents(),
          "getComputedStyle(document.querySelector('.sponsor')).display"));
  EXPECT_EQ(1, early_hits_.load());
}
}  // namespace merlin_adblock

namespace merlin_adblock {
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       TypedFetchXhrBeaconAndKeepaliveAreChecked) {
  Rules(
      "/typed-fetch$xmlhttprequest\n/typed-xhr$xmlhttprequest\n"
      "/typed-keepalive$xmlhttprequest\n/typed-beacon$ping");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  const std::string requests = R"JS((async()=>{
    const fetches=['/typed-fetch','/typed-keepalive'].map((url,index)=>
      fetch(url,{keepalive:!!index}).then(()=>true,()=>false));
    const xhr=new Promise(resolve=>{
      const xhr=new XMLHttpRequest();xhr.open('GET','/typed-xhr');
      xhr.onload=()=>resolve(true);xhr.onerror=()=>resolve(false);xhr.send();
    });
    navigator.sendBeacon('/typed-beacon','fixture');
    const result=await Promise.all([...fetches,xhr]);
    await new Promise(resolve=>setTimeout(resolve,300));
    return result.every(Boolean);
  })())JS";
  EXPECT_EQ(false, content::EvalJs(contents(), requests));
  EXPECT_EQ(0, typed_hits_.load());
  service()->SetEnabled(false);
  EXPECT_EQ(true, content::EvalJs(contents(), requests));
  ASSERT_TRUE(base::test::RunUntil([&] { return typed_hits_.load() == 4; }));
}
}  // namespace merlin_adblock

namespace merlin_adblock {
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       WorkerCachedAndSyntheticFetchesUseOwningContext) {
  Rules("/cached-ad$xmlhttprequest\n/synthetic-ad$xmlhttprequest");
  ControlledPage();
  for (const auto* kind : {"dedicated", "shared", "nested"}) {
    SCOPED_TRACE(kind);
    EXPECT_EQ("blocked", WorkerFetch(kind, "/cached-ad"));
    EXPECT_EQ("blocked", WorkerFetch(kind, "/synthetic-ad"));
  }
  EXPECT_EQ(0, blocked_hits_.load());
  service()->ToggleSite(Url("/sw-page", "localhost"));
  for (const auto* kind : {"dedicated", "shared", "nested"}) {
    SCOPED_TRACE(kind);
    EXPECT_EQ("window.cachedAdReached=true;", WorkerFetch(kind, "/cached-ad"));
    EXPECT_EQ("window.syntheticAdReached=true;",
              WorkerFetch(kind, "/synthetic-ad"));
  }
  EXPECT_EQ(0, blocked_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       WorkerReplacementAndRewriteRetainTypedDecisions) {
  Rules(
      "/replacement-ad$xmlhttprequest,redirect=fixture.js\n"
      "/rewritten$xmlhttprequest,removeparam=tracking",
      R"([{"name":"fixture.js","kind":{"mime":"application/javascript"},"content":"Zml4dHVyZQ=="}])");
  ControlledPage();
  for (const auto* kind : {"dedicated", "shared", "nested"}) {
    SCOPED_TRACE(kind);
    EXPECT_EQ("fixture", WorkerFetch(kind, "/replacement-ad"));
    EXPECT_EQ("window.rewriteQuery=\"?keep=2\";",
              WorkerFetch(kind, "/rewritten?tracking=1&keep=2"));
    EXPECT_EQ("fixture", WorkerFetch(kind, "/redirected-replacement"));
  }
}
}  // namespace merlin_adblock

namespace merlin_adblock {
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       HttpAndRendererCacheDoNotBypassChangedRules) {
  Rules("||unused.test^$script");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("loaded", Script(contents(), "/cached-network-ad"));
  EXPECT_EQ(1, cached_network_hits_.load());
  Rules("/cached-network-ad$script");
  EXPECT_EQ("blocked", Script(contents(), "/cached-network-ad"));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("blocked", Script(contents(), "/cached-network-ad"));
  EXPECT_EQ(false,
            content::EvalJs(contents(), "!!window.cachedNetworkAdReached"));
  EXPECT_EQ(1, cached_network_hits_.load());
  service()->SetEnabled(false);
  EXPECT_EQ("loaded", Script(contents(), "/cached-network-ad"));
  EXPECT_EQ(true,
            content::EvalJs(contents(), "!!window.cachedNetworkAdReached"));
  EXPECT_EQ(1, cached_network_hits_.load());
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ServiceWorkerNavigationCspIsAdditiveAndPreservesBody) {
  Rules("/synthetic-csp$csp=script-src 'none'");
  ControlledPage();
  ASSERT_TRUE(
      content::NavigateToURL(contents(), Url("/synthetic-csp", "localhost")));
  EXPECT_EQ(
      "body preserved",
      content::EvalJs(contents(),
                      "document.querySelector('#body-marker').textContent"));
  EXPECT_EQ(false, content::EvalJs(
                       contents(),
                       "!!window.inlineReached || !!window.allowedReached"));
  EXPECT_EQ(0, allowed_hits_.load());
  service()->ToggleSite(Url("/synthetic-csp", "localhost"));
  ASSERT_TRUE(
      content::NavigateToURL(contents(), Url("/synthetic-csp", "localhost")));
  EXPECT_EQ(false, content::EvalJs(contents(), "!!window.inlineReached"));
  EXPECT_EQ(true, content::EvalJs(contents(), "!!window.allowedReached"));
  EXPECT_EQ(1, allowed_hits_.load());
}
}  // namespace merlin_adblock

namespace merlin_adblock {
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       NetworkServiceRestartKeepsNativeProtection) {
  if (content::IsInProcessNetworkService())
    GTEST_SKIP() << "Requires an out-of-process Network Service";
  Rules("||ads.test^$script");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_EQ(0, blocked_hits_.load());
  EXPECT_EQ(1, allowed_hits_.load());
  SimulateNetworkServiceCrash();
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/page")));
  EXPECT_EQ(0, blocked_hits_.load());
  EXPECT_EQ(2, allowed_hits_.load());
  EXPECT_EQ(1u, service()->Blocked(contents()->GetPrimaryMainFrame()));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       PrivateProfileDestructionCancelsPendingGeneration) {
  auto* profile = browser()->GetProfile()->GetPrimaryOTRProfile(true);
  auto* blocker = Service::Get(profile);
  auto weak = blocker->GetWeakPtr();
  blocker->SetRulesForTesting("||ads.test^$script", "[]",
                              base::BindOnce([](bool) {}));
  ProfileDestroyer::DestroyOTRProfileWhenAppropriate(profile);
  ASSERT_TRUE(base::test::RunUntil([&] { return !weak; }));
  auto* next = browser()->GetProfile()->GetPrimaryOTRProfile(true);
  auto* next_blocker = Service::Get(next);
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return next_blocker->readiness() == Readiness::kReady; }));
  EXPECT_TRUE(next_blocker->Exceptions().empty());
  EXPECT_TRUE(service()->EnabledFor(Url("/page")));
}
}  // namespace merlin_adblock

namespace merlin_adblock {
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       OpaqueFrameCannotReuseAllowedFirstPartyScript) {
  Rules("/cached-network-ad$script,third-party");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  EXPECT_EQ("loaded", Script(contents(), "/cached-network-ad"));
  EXPECT_EQ(1, cached_network_hits_.load());
  ASSERT_EQ(true, content::EvalJs(contents(), content::JsReplace(
                                                  R"JS(new Promise(resolve=>{
    const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
    frame.onload=()=>resolve(true);
    frame.srcdoc='<script src="'+$1+'"><'+'/script>';
    document.body.append(frame);
  }))JS",
                                                  Url("/cached-network-ad"))));
  auto* child = content::ChildFrameAt(contents(), 0);
  ASSERT_TRUE(child);
  EXPECT_TRUE(child->GetLastCommittedOrigin().opaque());
  EXPECT_EQ(false, content::EvalJs(child, "!!window.cachedNetworkAdReached"));
  EXPECT_EQ(1, cached_network_hits_.load());
}
}  // namespace merlin_adblock

namespace merlin_adblock {
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ImagesStylesFontsMediaWorkersAndPrefetchAreChecked) {
  Rules(
      "/typed-style$stylesheet\n/typed-image$image\n/typed-font$font\n"
      "/typed-media$media\n/typed-worker$script\n/typed-prefetch$other");
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early")));
  const std::string requests = R"JS((async()=>{
    function load(node,url){return new Promise(resolve=>{
      node.onload=node.onerror=()=>resolve(true);
      if(node.tagName==='LINK')node.href=url;else node.src=url;
      document.body.append(node);setTimeout(resolve,2000);
    });}
    const style=document.createElement('link');style.rel='stylesheet';
    const prefetch=document.createElement('link');prefetch.rel='prefetch';
    const video=document.createElement('video');video.preload='auto';video.muted=true;
    const font=new FontFace('fixture','url(/typed-font.woff2)');
    const worker=new Promise(resolve=>{
      const worker=new Worker('/typed-worker.js');
      const done=()=>{worker.terminate();resolve(true);};
      worker.onmessage=worker.onerror=done;setTimeout(done,2000);
    });
    await Promise.all([load(style,'/typed-style.css'),load(new Image(),'/typed-image.png'),
      load(video,'/typed-media.webm'),load(prefetch,'/typed-prefetch'),
      font.load().then(()=>true,()=>true),worker]);
    return true;
  })())JS";
  EXPECT_EQ(true, content::EvalJs(contents(), requests));
  EXPECT_EQ(0, typed_hits_.load());
  EXPECT_EQ(0u, typed_mask_.load());
  service()->SetEnabled(false);
  EXPECT_EQ(true, content::EvalJs(contents(), requests));
  ASSERT_TRUE(base::test::RunUntil([&] { return typed_mask_.load() == 63u; }));
}

IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       EarlyHintsPreloadsAreCheckedBeforeServerDispatch) {
  Rules("/typed-early.js$script");
  std::atomic<int> hits{0};
  net::EmbeddedTestServer server(net::EmbeddedTestServer::TYPE_HTTPS);
  server.SetSSLConfig(net::EmbeddedTestServer::CERT_TEST_NAMES);
  server.RegisterRequestHandler(base::BindRepeating(
      [](std::atomic<int>* hits, const net::test_server::HttpRequest& request)
          -> std::unique_ptr<net::test_server::HttpResponse> {
        if (request.relative_url.starts_with("/hints"))
          return std::make_unique<net::test_server::RawHttpResponse>(
              "HTTP/1.1 103 Early Hints\r\nLink: </typed-early.js>; "
              "rel=preload; as=script\r\n\r\n"
              "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nCache-Control: "
              "no-store\r\nConnection: close\r\n",
              "<!doctype html><title>Early Hints fixture</title>");
        auto response = std::make_unique<net::test_server::BasicHttpResponse>();
        response->set_code(net::HTTP_OK);
        response->set_content_type("application/javascript");
        response->AddCustomHeader("Cache-Control", "no-store");
        response->set_content("/* preload fixture */");
        if (request.relative_url == "/typed-early.js")
          ++*hits;
        return response;
      },
      &hits));
  ASSERT_TRUE(server.Start());
  ASSERT_TRUE(
      content::NavigateToURL(contents(), server.GetURL("a.test", "/hints")));
  ASSERT_TRUE(base::test::RunUntil([&] {
    return service()->Blocked(contents()->GetPrimaryMainFrame()) == 1u;
  }));
  EXPECT_EQ(0, hits.load());
  service()->SetEnabled(false);
  ASSERT_TRUE(content::NavigateToURL(
      contents(), server.GetURL("a.test", "/hints?control")));
  ASSERT_TRUE(base::test::RunUntil([&] { return hits.load() == 1; }));
}
}  // namespace merlin_adblock

namespace merlin_adblock {
IN_PROC_BROWSER_TEST_F(MerlinAdblockBrowserTest,
                       ExistingControlledDocumentUsesLiveProtectionSettings) {
  Rules("/cached-ad$script\n/synthetic-ad$script");
  service()->SetEnabled(false);
  ControlledPage();
  EXPECT_EQ("loaded", Script(contents(), "/cached-ad"));
  service()->SetEnabled(true);
  EXPECT_EQ("blocked", Script(contents(), "/synthetic-ad"));
  service()->ToggleSite(Url("/sw-page", "localhost"));
  EXPECT_EQ("loaded", Script(contents(), "/synthetic-ad"));
  service()->ToggleSite(Url("/sw-page", "localhost"));
  EXPECT_EQ("blocked", Script(contents(), "/cached-ad"));
  EXPECT_EQ(0, blocked_hits_.load());
}

class MerlinAdblockWebTransportBrowserTest : public MerlinAdblockBrowserTest {
 public:
  MerlinAdblockWebTransportBrowserTest() { transport_.Start(); }
  void SetUpCommandLine(base::CommandLine* command_line) override {
    MerlinAdblockBrowserTest::SetUpCommandLine(command_line);
    // Chromium's test server pins its own certificate SPKI, without changing
    // production certificate checks or the browser's security configuration.
    transport_.SetUpCommandLine(command_line);
  }

 protected:
  content::WebTransportSimpleTestServer transport_;
};

IN_PROC_BROWSER_TEST_F(MerlinAdblockWebTransportBrowserTest,
                       ConnectPolicyAndExceptionsInFramesAndWorkers) {
  ASSERT_NO_FATAL_FAILURE(Rules("||never.invalid^"));
  ASSERT_TRUE(content::NavigateToURL(contents(), Url("/early", "localhost")));
  const std::string endpoint =
      "https://localhost:" +
      base::NumberToString(transport_.server_address().port()) + "/echo";
  const std::string direct = R"JS((async()=>{
    const t=new WebTransport($1);
    try{await t.ready;t.close();return 'connected';}
    catch(e){return 'blocked';}
  })())JS";
  auto worker = [&](bool shared) {
    return content::EvalJs(contents(),
                           content::JsReplace(R"JS(new Promise(resolve=>{
      const code="async function check(port,url){const t=new WebTransport(url);try{await t.ready;t.close();port.postMessage('connected');}catch(e){port.postMessage('blocked');}}\n"+
        ($2 ? 'onconnect=e=>{const p=e.ports[0];p.onmessage=e=>check(p,e.data);p.start();}' : 'onmessage=e=>check(self,e.data);');
      const blob=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
      const worker=$2?new SharedWorker(blob):new Worker(blob),port=$2?worker.port:worker;
      port.onmessage=e=>{resolve(e.data);if($2)port.close();else worker.terminate();URL.revokeObjectURL(blob);};
      if($2)port.start();port.postMessage($1);
    }))JS",
                                              endpoint, shared))
        .ExtractString();
  };
  EXPECT_EQ("connected",
            content::EvalJs(contents(), content::JsReplace(direct, endpoint)));
  for (bool shared : {false, true})
    EXPECT_EQ("connected", worker(shared));
  ASSERT_NO_FATAL_FAILURE(Rules("||localhost^$other"));
  base::test::TestFuture<Decision> policy;
  service()->Check(GURL(endpoint), Url("/early", "localhost"),
                   Url("/early", "localhost"), "CONNECT", 0,
                   policy.GetCallback());
  ASSERT_EQ(DecisionKind::kBlock, policy.Get().kind);
  const unsigned before = service()->Blocked(contents()->GetPrimaryMainFrame());
  EXPECT_EQ("blocked",
            content::EvalJs(contents(), content::JsReplace(direct, endpoint)));
  EXPECT_EQ(before + 1, service()->Blocked(contents()->GetPrimaryMainFrame()));
  for (bool shared : {false, true})
    EXPECT_EQ("blocked", worker(shared));
  service()->ToggleSite(Url("/early", "localhost"));
  EXPECT_EQ("connected",
            content::EvalJs(contents(), content::JsReplace(direct, endpoint)));
  for (bool shared : {false, true})
    EXPECT_EQ("connected", worker(shared));
  service()->ToggleSite(Url("/early", "localhost"));
  service()->SetEnabled(false);
  EXPECT_EQ("connected",
            content::EvalJs(contents(), content::JsReplace(direct, endpoint)));
}

}  // namespace merlin_adblock
