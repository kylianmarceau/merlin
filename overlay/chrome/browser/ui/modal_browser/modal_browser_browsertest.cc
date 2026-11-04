// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// End-to-end tests in a real browser. Keys are built as the macOS view builds
// them for an ordinary (non-IME) key press and sent through
// RenderWidgetHost::ForwardKeyboardEvent, so they take the real path:
// RenderWidgetHostImpl -> WebContentsImpl -> BrowserWebContentsDelegate ->
// BrowserView::PreHandleKeyboardEvent -> ModalBrowserController.
//
// content::SimulateKeyPress cannot be used: its events are marked
// skip_if_unhandled (as for IME input), so Chromium never pre-handles them.
// OS-level focus and window activation are not covered here; that needs
// interactive_ui_tests.

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <array>
#include <memory>
#include <string>

#include "base/base_paths.h"
#include "base/command_line.h"
#include "base/environment.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/files/scoped_file.h"
#include "base/files/scoped_temp_dir.h"
#include "base/json/json_reader.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/run_loop.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/thread_pool.h"
#include "base/test/bind.h"
#include "base/test/run_until.h"
#include "base/test/test_future.h"
#include "base/threading/thread_restrictions.h"
#include "base/time/time.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/extensions/chrome_test_extension_loader.h"
#include "chrome/browser/history/history_service_factory.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "chrome/browser/prefs/session_startup_pref.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/themes/theme_service_factory.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_element_identifiers.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/modal_browser/browserctl_server.h"
#include "chrome/browser/ui/modal_browser/config_file.h"
#include "chrome/browser/ui/modal_browser/external_editor.h"
#include "chrome/browser/ui/modal_browser/hint_overlay_view.h"
#include "chrome/browser/ui/modal_browser/merlin_address_editor.h"
#include "chrome/browser/ui/modal_browser/merlin_library_pages.h"
#include "chrome/browser/ui/modal_browser/merlin_page_color.h"
#include "chrome/browser/ui/modal_browser/merlin_safety_controls.h"
#include "chrome/browser/ui/modal_browser/merlin_settings_page.h"
#include "chrome/browser/ui/modal_browser/merlin_start_page.h"
#include "chrome/browser/ui/modal_browser/merlin_tab_bar.h"
#include "chrome/browser/ui/modal_browser/merlin_toolbar.h"
#include "chrome/browser/ui/modal_browser/merlin_urls.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/modal_browser/palette_view.h"
#include "chrome/browser/ui/modal_browser/status_view.h"
#include "chrome/browser/ui/modal_browser/workspace_store.h"
#include "chrome/browser/ui/permission_bubble/permission_bubble_test_util.h"
#include "chrome/browser/ui/tabs/alert/tab_alert_controller.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/vertical_tab_strip_state_controller.h"
#include "chrome/browser/ui/views/bubble_anchor_util_views.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/multi_contents_view.h"
#include "chrome/browser/ui/views/interaction/browser_elements_views.h"
#include "chrome/browser/ui/views/location_bar/location_bar_view.h"
#include "chrome/browser/ui/views/page_info/page_info_bubble_view_base.h"
#include "chrome/browser/ui/views/permissions/permission_prompt_bubble_base_view.h"
#include "chrome/browser/ui/views/permissions/permission_prompt_bubble_view_factory.h"
#include "chrome/browser/ui/views/permissions/permission_prompt_style.h"
#include "chrome/browser/ui/views/toolbar/reload_button.h"
#include "chrome/browser/ui/views/toolbar/toolbar_button.h"
#include "chrome/browser/ui/views/toolbar/toolbar_view.h"
#include "chrome/common/pref_names.h"
#include "chrome/common/webui_url_constants.h"
#include "chrome/grit/theme_resources.h"
#include "chrome/test/base/in_process_browser_test.h"
#include "chrome/test/base/ui_test_utils.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/history/core/browser/history_service.h"
#include "components/input/native_web_keyboard_event.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/omnibox/browser/omnibox_pref_names.h"
#include "components/permissions/permission_prompt.h"
#include "components/permissions/request_type.h"
#include "components/permissions/test/mock_permission_request.h"
#include "components/prefs/pref_service.h"
#include "components/security_state/content/content_utils.h"
#include "components/security_state/core/security_state.h"
#include "components/split_tabs/split_tab_id.h"
#include "components/split_tabs/split_tab_visual_data.h"
#include "components/tabs/public/split_tab_data.h"
#include "components/tabs/public/tab_interface.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "components/zoom/zoom_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_controller.h"
#include "content/public/test/browser_test.h"
#include "content/public/test/browser_test_utils.h"
#include "content/public/test/test_navigation_observer.h"
#include "extensions/common/extension.h"
#include "net/dns/mock_host_resolver.h"
#include "net/test/embedded_test_server/embedded_test_server.h"
#include "net/test/embedded_test_server/http_request.h"
#include "net/test/embedded_test_server/http_response.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "third_party/skia/include/core/SkCanvas.h"
#include "third_party/skia/include/core/SkImage.h"
#include "ui/accessibility/ax_action_data.h"
#include "ui/accessibility/ax_node_data.h"
#include "ui/base/clipboard/clipboard.h"
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "ui/base/clipboard/test/test_clipboard.h"
#include "ui/base/resource/resource_bundle.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_provider_key.h"
#include "ui/events/event.h"
#include "ui/events/event_utils.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/color_utils.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_rep.h"
#include "ui/native_theme/native_theme.h"
#include "ui/views/accessibility/ax_update_notifier.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/controls/textfield/textfield.h"
#include "ui/views/focus/focus_manager.h"
#include "ui/views/test/ax_event_counter.h"
#include "ui/views/test/button_test_api.h"
#include "ui/views/test/views_drawing_test_utils.h"
#include "ui/views/view_utils.h"
#include "ui/views/widget/widget.h"

namespace modal_browser {

// Deterministic result fixtures exercise the real card's accessibility and
// actions without relying on remote suggestions or a populated user history.
struct MerlinAddressEditorTestPeer {
  static void Results(MerlinAddressEditor& editor,
                      std::vector<MerlinSuggestions::Suggestion> results) {
    editor.suggestions_->Stop();
    editor.OnResults(results);
  }
};

// Supplies compositor results deterministically without depending on GPU timing.
struct PageColorSamplerTestPeer {
  static auto Begin(PageColorSampler& sampler, content::WebContents* contents) {
    sampler.soon_.Stop();
    sampler.sampling_ = true;
    return base::BindOnce(&PageColorSampler::OnSampled,
                         sampler.weak_factory_.GetWeakPtr(),
                         contents->GetPrimaryMainFrame()->GetWeakDocumentPtr());
  }
  static void StopTimer(PageColorSampler& sampler) { sampler.soon_.Stop(); }
};

namespace {

// A text field, a rich editor, a log of every key the page receives, and
// enough height to scroll.
constexpr char kPageHtml[] = R"(<!doctype html>
<title>modal</title>
<input id="t">
<div id="c" contenteditable>rich</div>
<p id="log"></p>
<div style="height: 5000px"></div>
<script>
  addEventListener('keydown', e => {
    document.getElementById('log').textContent += e.key + ' ';
  });
</script>)";

// Four targets in document order: three links and a text field. Labels for
// four targets are s, a, d, f in that order.
constexpr char kHintsHtml[] = R"(<!doctype html>
<title>hints</title>
<style>a, input { display: block; margin: 12px; font-size: 18px; }</style>
<a id="one" href="/one">One</a>
<a id="two" href="/two">Two</a>
<a id="three" href="/three" target="_blank">Three</a>
<input id="field" placeholder="type here">
<a id="hidden" href="/hidden" style="display:none">Hidden</a>
<div style="position:relative; height: 40px">
  <a id="covered" href="/covered">Covered</a>
  <div style="position:absolute; inset:0; background:white"></div>
</div>)";

// The document does not scroll; an inner panel does (like many docs sites).
constexpr char kInnerScrollHtml[] = R"(<!doctype html>
<title>inner</title>
<style>html, body { margin: 0; height: 100%; overflow: hidden; }
#panel { height: 100%; overflow: auto; }</style>
<div id="panel"><div style="height: 5000px">tall</div></div>)";

// A documentation page: headings, a paragraph with a link and inline code,
// a code block, a table, and enough length to scroll between sections.
constexpr char kDocHtml[] = R"(<!doctype html>
<title>Foo docs</title>
<main>
<h1>Foo</h1>
<p id="intro">Read the <a href="https://docs.rs/foo">docs</a> or call
<code>foo()</code> now.</p>
<h2>Install</h2>
<pre class="language-sh">cargo add foo</pre>
<div style="height: 1500px"></div>
<h2 id="usage">Usage</h2>
<table><tr><th>Name</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table>
<div style="height: 3000px"></div>
</main>)";

// A comment box (like GitHub's) and a password field.
constexpr char kFormHtml[] = R"(<!doctype html>
<title>form</title>
<textarea id="comment">first draft</textarea>
<input id="pw" type="password" value="secret">
<p id="log"></p>
<script>
  document.getElementById('comment').addEventListener('input', e => {
    document.getElementById('log').textContent += 'input:' + e.inputType + ' ';
  });
</script>)";

// A link in the page, one in a same-origin iframe, one in a cross-site
// iframe (an out-of-process frame); filled in with the cross-site URL.
constexpr char kFramesHtml[] = R"(<!doctype html>
<title>frames</title>
<style>a { display: block; margin: 12px; font-size: 18px; }
iframe { display: block; width: 420px; height: 90px; border: 0; }</style>
<a href="/one">Main link</a>
<iframe id="same" srcdoc="<a href='/inner' style='font-size:18px'>Inner link</a>"></iframe>
<iframe id="cross" src="CROSS"></iframe>)";

constexpr char kCrossFrameHtml[] =
    R"(<!doctype html><a href="/two" style="font-size:18px">Cross link</a>)";

// The cross-site frame's URL, set once the server has started.
std::string& CrossFrameUrl() {
  static base::NoDestructor<std::string> url;
  return *url;
}

std::unique_ptr<net::test_server::HttpResponse> ServePage(
    const net::test_server::HttpRequest& request) {
  auto response = std::make_unique<net::test_server::BasicHttpResponse>();
  if (request.relative_url == "/hints") {
    response->set_content(kHintsHtml);
  } else if (request.relative_url == "/inner") {
    response->set_content(kInnerScrollHtml);
  } else if (request.relative_url == "/doc") {
    response->set_content(kDocHtml);
  } else if (request.relative_url == "/form") {
    response->set_content(kFormHtml);
  } else if (request.relative_url == "/frames") {
    std::string html = kFramesHtml;
    html.replace(html.find("CROSS"), 5, CrossFrameUrl());
    response->set_content(html);
  } else if (request.relative_url == "/frame") {
    response->set_content(kCrossFrameHtml);
  } else {
    response->set_content(kPageHtml);
  }
  response->set_content_type("text/html");
  return response;
}

struct KeySpec {
  ui::DomKey key;
  ui::DomCode code;
  ui::KeyboardCode vkey;
};

KeySpec Letter(char c) {
  const char lower = static_cast<char>(c | 0x20);
  return {ui::DomKey::FromCharacter(c),
          static_cast<ui::DomCode>(static_cast<int>(ui::DomCode::US_A) +
                                   (lower - 'a')),
          static_cast<ui::KeyboardCode>(ui::VKEY_A + (lower - 'a'))};
}

}  // namespace

// Sends one browserctl request line over the socket and returns the reply,
// on a background thread (the browser answers on the UI thread).
std::string BrowserctlExchange(const base::FilePath& socket_path,
                               const std::string& line) {
  base::ScopedFD fd(socket(AF_UNIX, SOCK_STREAM, 0));
  sockaddr_un addr = {};
  addr.sun_family = AF_UNIX;
  if (socket_path.value().size() >= sizeof(addr.sun_path)) {
    return "socket path too long";
  }
  base::span(addr.sun_path).copy_prefix_from(base::span(socket_path.value()));
  if (!fd.is_valid() ||
      connect(fd.get(), reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    return "connect failed";
  }
  const std::string request = line + "\n";
  if (write(fd.get(), request.data(), request.size()) !=
      static_cast<ssize_t>(request.size())) {
    return "write failed";
  }
  std::string reply;
  std::array<char, 4096> buf;
  for (;;) {
    const ssize_t n = read(fd.get(), buf.data(), buf.size());
    if (n <= 0) {
      break;
    }
    reply.append(base::span(buf).first(static_cast<size_t>(n)).begin(),
                 base::span(buf).first(static_cast<size_t>(n)).end());
  }
  return reply;
}

class ModalBrowserBrowserTest : public InProcessBrowserTest {
 protected:
  void SetUpCommandLine(base::CommandLine* command_line) override {
    // Never touch the developer's own socket or workspaces.
    base::ScopedAllowBlockingForTesting allow;
    ASSERT_TRUE(socket_dir_.CreateUniqueTempDir());
    command_line->AppendSwitchPath(kBrowserctlSocketSwitch, SocketPath());
  }

  void SetUpInProcessBrowserTestFixture() override {
    // Never read the developer's own config: point at a file that does not
    // exist yet; tests that need one write it.
    base::ScopedAllowBlockingForTesting allow;
    ASSERT_TRUE(config_dir_.CreateUniqueTempDir());
    config_file::SetConfigPathForTesting(ConfigPath());
    workspace_store::SetDirectoryForTesting(
        config_dir_.GetPath().Append("workspaces"));
  }

  base::FilePath SocketPath() {
    return socket_dir_.GetPath().Append("s.sock");
  }

  // One browserctl round trip, keeping the UI thread running.
  std::string Browserctl(const std::string& line) {
    base::test::TestFuture<std::string> reply;
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, {base::MayBlock()},
        base::BindOnce(&BrowserctlExchange, SocketPath(), line),
        reply.GetCallback());
    return reply.Take();
  }

  // Runs a command line and waits until the page-side or file work it
  // starts has reported back.
  void RunAndWait(std::string_view line) { RunAndWaitOn(controller(), line); }

  void RunAndWaitOn(ModalBrowserController* target, std::string_view line) {
    base::RunLoop loop;
    target->set_page_work_done_callback_for_testing(loop.QuitClosure());
    EXPECT_EQ(target->RunCommandLine(line), "") << line;
    loop.Run();
    target->set_page_work_done_callback_for_testing({});
  }

  std::u16string StatusMessage() {
    return status() ? status()->state().message : std::u16string();
  }

  void SetUpOnMainThread() override {
    // An in-memory clipboard, so tests never read or overwrite the system
    // pasteboard of whoever runs them.
    ui::TestClipboard::CreateForCurrentThread();
    host_resolver()->AddRule("*", "127.0.0.1");
    embedded_test_server()->RegisterRequestHandler(
        base::BindRepeating(&ServePage));
    ASSERT_TRUE(embedded_test_server()->Start());
    CrossFrameUrl() =
        embedded_test_server()->GetURL("b.test", "/frame").spec();
    ASSERT_TRUE(ui_test_utils::NavigateToURL(
        browser(), embedded_test_server()->GetURL("/page")));
    contents()->Focus();
  }

  void TearDownOnMainThread() override {
    ui::Clipboard::DestroyClipboardForCurrentThread();
  }

  base::FilePath ConfigPath() { return config_dir_.GetPath().Append("config.toml"); }

  content::WebContents* contents() {
    return browser()->tab_strip_model()->GetActiveWebContents();
  }

  ModalBrowserController* controller() {
    return ModalBrowserController::From(browser());
  }

  ffi::Mode mode() { return controller()->mode_for_testing(); }

  void Press(const KeySpec& k, bool shift = false, bool ctrl = false) {
    const int modifiers = (shift ? blink::WebInputEvent::kShiftKey : 0) |
                          (ctrl ? blink::WebInputEvent::kControlKey : 0);
    content::RenderWidgetHost* widget =
        contents()->GetPrimaryMainFrame()->GetRenderWidgetHost();
    for (auto type : {blink::WebInputEvent::Type::kRawKeyDown,
                      blink::WebInputEvent::Type::kChar,
                      blink::WebInputEvent::Type::kKeyUp}) {
      input::NativeWebKeyboardEvent event(type, modifiers,
                                          base::TimeTicks::Now());
      event.dom_key = k.key;
      event.dom_code = static_cast<int>(k.code);
      event.native_key_code =
          ui::KeycodeConverter::DomCodeToNativeKeycode(k.code);
      event.windows_key_code = k.vkey;
      // An ordinary key press; only IME composition sets this.
      event.skip_if_unhandled = false;
      if (type != blink::WebInputEvent::Type::kKeyUp) {
        const char16_t c = k.key.IsCharacter()
                               ? static_cast<char16_t>(k.key.ToCharacter())
                               : static_cast<char16_t>(k.vkey);
        event.text[0] = c;
        event.unmodified_text[0] = c;
      }
      widget->ForwardKeyboardEvent(event);
    }
  }
  void PressLetter(char c, bool ctrl = false) {
    Press(Letter(c), /*shift=*/c >= 'A' && c <= 'Z', ctrl);
  }
  void PressLetters(std::string_view letters) {
    for (char c : letters) {
      PressLetter(c);
    }
  }
  void PressColon() {
    Press({ui::DomKey::FromCharacter(':'), ui::DomCode::SEMICOLON,
           ui::VKEY_OEM_1},
          /*shift=*/true);
  }
  void PressQuestion() {
    Press({ui::DomKey::FromCharacter('?'), ui::DomCode::SLASH, ui::VKEY_OEM_2},
          /*shift=*/true);
  }
  void PressDigit(char d) {
    Press({ui::DomKey::FromCharacter(d),
           static_cast<ui::DomCode>(static_cast<int>(ui::DomCode::DIGIT1) +
                                    (d == '0' ? 9 : d - '1')),
           static_cast<ui::KeyboardCode>(ui::VKEY_0 + (d - '0'))});
  }
  void PressEscape(bool shift = false) {
    Press({ui::DomKey::ESCAPE, ui::DomCode::ESCAPE, ui::VKEY_ESCAPE}, shift);
  }

  std::string PageLog() {
    return content::EvalJs(contents(),
                           "document.getElementById('log').textContent")
        .ExtractString();
  }
  int ScrollY() {
    return content::EvalJs(contents(), "Math.round(window.scrollY)")
        .ExtractInt();
  }

  PaletteHost* palette() { return controller()->palette_for_testing(); }
  PaletteView* palette_view() { return palette()->view_for_testing(); }
  StatusView* status() {
    return controller()->status_for_testing()->view_for_testing();
  }
  HintHost* hints() { return controller()->hints_for_testing(); }

  // Types into the palette's real text field (replacing its text) the way
  // typing does, then presses `key` there.
  void TypeInPalette(std::u16string_view text, ui::KeyboardCode key) {
    views::Textfield* field = palette_view()->textfield();
    field->SelectAll(false);
    if (text.empty()) {
      field->DeleteRange(field->GetSelectedRange());
      palette_view()->ContentsChanged(field, u"");
    } else {
      field->InsertOrReplaceText(std::u16string(text));
    }
    if (key != ui::VKEY_UNKNOWN) {
      ui::KeyEvent event(ui::EventType::kKeyPressed, key, ui::EF_NONE);
      field->OnKeyEvent(&event);
    }
  }

  void FocusElement(const char* id) {
    ASSERT_TRUE(content::ExecJs(
        contents(), std::string("document.getElementById('") + id +
                        "').focus()"));
    ASSERT_TRUE(base::test::RunUntil(
        [&] { return contents()->IsFocusedElementEditable(); }));
  }

  void NavigateTo(const std::string& path) {
    ASSERT_TRUE(ui_test_utils::NavigateToURL(
        browser(), embedded_test_server()->GetURL(path)));
    contents()->Focus();
  }

  // Presses keys that start hint mode and waits for the labels.
  std::vector<std::u16string> ShowHints(std::string_view keys) {
    PressLetters(keys);
    EXPECT_EQ(mode(), ffi::Mode::Hint);
    EXPECT_TRUE(base::test::RunUntil([&] { return hints()->IsVisible(); }));
    return hints()->view_for_testing()->VisibleLabels();
  }

  void WriteConfig(std::string_view text) {
    base::ScopedAllowBlockingForTesting allow;
    ASSERT_TRUE(base::WriteFile(ConfigPath(), text));
  }

  // Runs `:config-reload` and waits for the file to be read and applied.
  void ReloadConfig() {
    base::RunLoop loop;
    controller()->set_page_work_done_callback_for_testing(loop.QuitClosure());
    controller()->RunCommandLine("config-reload");
    loop.Run();
    controller()->set_page_work_done_callback_for_testing({});
  }

  std::u16string ReadClipboard() {
    base::test::TestFuture<std::u16string> text;
    ui::Clipboard::GetForCurrentThread()->ReadText(
        ui::ClipboardBuffer::kCopyPaste, std::nullopt, text.GetCallback());
    return text.Take();
  }

  base::ScopedTempDir config_dir_;
  base::ScopedTempDir socket_dir_;
};

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ControllerExistsForWindow) {
  ASSERT_NE(controller(), nullptr);
  EXPECT_EQ(mode(), ffi::Mode::Normal);
}

// ':' -> 'tabnew <url>' -> a real tab loads that URL.
IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ColonTabnewOpensRealTab) {
  PressColon();
  EXPECT_EQ(mode(), ffi::Mode::Command);
  ASSERT_TRUE(palette()->IsVisible());
  EXPECT_EQ(palette_view()->model().kind, ffi::PaletteKind::CommandLine);
  // Keyboard focus in the palette needs an active OS window, which
  // browser_tests does not guarantee; that check belongs in
  // interactive_ui_tests.
  EXPECT_EQ(PageLog(), "") << "':' must not reach the page";

  const GURL target = embedded_test_server()->GetURL("/target");
  content::TestNavigationObserver navigation(target);
  navigation.StartWatchingNewWebContents();
  TypeInPalette(u"tabnew " + base::UTF8ToUTF16(target.spec()),
                ui::VKEY_RETURN);
  navigation.Wait();

  EXPECT_EQ(browser()->tab_strip_model()->count(), 2);
  EXPECT_EQ(browser()->tab_strip_model()->active_index(), 1);
  EXPECT_EQ(contents()->GetLastCommittedURL(), target);
  EXPECT_EQ(mode(), ffi::Mode::Normal);
  EXPECT_FALSE(palette()->IsVisible());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, CommandErrorKeepsLineOpen) {
  PressColon();
  TypeInPalette(u"tabnw x", ui::VKEY_RETURN);
  EXPECT_EQ(mode(), ffi::Mode::Command);
  EXPECT_EQ(browser()->tab_strip_model()->count(), 1);
  EXPECT_EQ(palette_view()->model().error,
            u"unknown command 'tabnw' (did you mean 'tabnew'?)");

  TypeInPalette(u"open javascript:alert(1)", ui::VKEY_RETURN);
  EXPECT_EQ(mode(), ffi::Mode::Command);
  EXPECT_EQ(contents()->GetLastCommittedURL().path(), "/page");

  TypeInPalette(u"", ui::VKEY_ESCAPE);
  EXPECT_EQ(mode(), ffi::Mode::Normal);
  EXPECT_FALSE(palette()->IsVisible());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, CommandLineCompletesWithTab) {
  PressColon();
  TypeInPalette(u"tabn", ui::VKEY_UNKNOWN);
  ASSERT_FALSE(palette_view()->model().rows.empty());
  EXPECT_EQ(palette_view()->model().rows[0].primary, u"tabnew");
  // Matched characters are marked for highlighting.
  EXPECT_EQ(palette_view()->model().rows[0].primary_marks.size(), 4u);
  ui::KeyEvent tab(ui::EventType::kKeyPressed, ui::VKEY_TAB, ui::EF_NONE);
  palette_view()->textfield()->OnKeyEvent(&tab);
  EXPECT_EQ(palette_view()->textfield()->GetText(), u"tabnew");
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, TypingInTextFieldIsNotHijacked) {
  FocusElement("t");
  PressLetter('j');
  PressLetter('d');
  PressColon();
  PressLetter('G');
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(), "document.getElementById('t').value") ==
           "jd:G";
  }));
  EXPECT_EQ(browser()->tab_strip_model()->count(), 1);
  EXPECT_EQ(mode(), ffi::Mode::Insert);
  EXPECT_EQ(ScrollY(), 0);
  // The mode pill is the visible affordance for Insert.
  ASSERT_TRUE(status());
  EXPECT_TRUE(controller()->status_for_testing()->widget_for_testing()->IsVisible());
  EXPECT_EQ(status()->state().indicator, u"INSERT");
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, RichEditorIsNotHijacked) {
  FocusElement("c");
  PressLetter('x');
  PressLetter('d');
  EXPECT_EQ(mode(), ffi::Mode::Insert);
  EXPECT_EQ(browser()->tab_strip_model()->count(), 1);
  ASSERT_TRUE(base::test::RunUntil([&] { return PageLog() == "x d "; }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, EscapeLeavesFieldThenJScrolls) {
  FocusElement("t");
  PressEscape();
  EXPECT_EQ(mode(), ffi::Mode::Normal);
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return !contents()->IsFocusedElementEditable(); }));
  EXPECT_EQ(PageLog(), "") << "Esc that leaves Insert is consumed";

  PressLetter('j');
  ASSERT_TRUE(base::test::RunUntil([&] { return ScrollY() == 60; }));
  EXPECT_EQ(PageLog(), "") << "'j' is a command in Normal mode";
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, CountsAndSequences) {
  PressDigit('5');
  PressLetter('j');
  ASSERT_TRUE(base::test::RunUntil([&] { return ScrollY() == 300; }));
  PressLetter('G');
  ASSERT_TRUE(base::test::RunUntil([&] { return ScrollY() > 1000; }));
  PressLetter('g');
  PressLetter('g');
  ASSERT_TRUE(base::test::RunUntil([&] { return ScrollY() == 0; }));
  EXPECT_EQ(PageLog(), "");
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, UnboundKeysReachPage) {
  PressLetter('z');
  PressEscape();
  ASSERT_TRUE(base::test::RunUntil([&] { return PageLog() == "z Escape "; }));
  EXPECT_EQ(mode(), ffi::Mode::Normal);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, PassthroughForwardsEscape) {
  PressLetter('v', /*ctrl=*/true);
  EXPECT_EQ(mode(), ffi::Mode::Passthrough);
  PressLetter('j');
  PressEscape();
  ASSERT_TRUE(base::test::RunUntil([&] { return PageLog() == "j Escape "; }));
  EXPECT_EQ(ScrollY(), 0);
  PressEscape(/*shift=*/true);
  EXPECT_EQ(mode(), ffi::Mode::Normal);
  EXPECT_EQ(PageLog(), "j Escape ");
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, HistoryKeys) {
  const GURL first = contents()->GetLastCommittedURL();
  const GURL second = embedded_test_server()->GetURL("/second");
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), second));
  contents()->Focus();

  content::TestNavigationObserver back(contents());
  PressLetter('H');
  back.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL(), first);

  content::TestNavigationObserver forward(contents());
  PressLetter('L');
  forward.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL(), second);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, TOpensNewTab) {
  PressLetter('t');
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return browser()->tab_strip_model()->count() == 2; }));
}

// -- Phase 2: link hints ------------------------------------------------------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, HintsLabelVisibleTargets) {
  NavigateTo("/hints");
  std::vector<std::u16string> labels = ShowHints("f");
  // one, two, three, field; the hidden and covered links get no label.
  EXPECT_EQ(labels, (std::vector<std::u16string>{u"s", u"a", u"d", u"f"}));
  EXPECT_EQ(status()->state().indicator, u"HINT");
  PressEscape();
  EXPECT_EQ(mode(), ffi::Mode::Normal);
  EXPECT_FALSE(hints()->IsVisible());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, HintFollowsLinkWithRealClick) {
  NavigateTo("/hints");
  ShowHints("f");
  const GURL two = embedded_test_server()->GetURL("/two");
  content::TestNavigationObserver navigation(contents());
  PressLetter('a');  // the second target, "Two"
  navigation.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL(), two);
  EXPECT_FALSE(hints()->IsVisible());
  EXPECT_EQ(mode(), ffi::Mode::Normal);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, HintClickOnInputEntersInsert) {
  NavigateTo("/hints");
  ShowHints("f");
  PressLetter('f');  // the text field
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return contents()->IsFocusedElementEditable(); }));
  ASSERT_TRUE(base::test::RunUntil([&] { return mode() == ffi::Mode::Insert; }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, CapitalFOpensLinkInBackground) {
  NavigateTo("/hints");
  std::vector<std::u16string> labels = ShowHints("F");
  EXPECT_EQ(labels.size(), 3u) << "links only, not the field";
  PressLetter('a');  // "Two"
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return browser()->tab_strip_model()->count() == 2; }));
  EXPECT_EQ(browser()->tab_strip_model()->active_index(), 0) << "background";
  EXPECT_EQ(browser()->tab_strip_model()->GetWebContentsAt(1)->GetVisibleURL(),
            embedded_test_server()->GetURL("/two"));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, GiFocusesTheOnlyField) {
  NavigateTo("/hints");
  PressLetters("gi");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return contents()->IsFocusedElementEditable(); }));
  ASSERT_TRUE(base::test::RunUntil([&] { return mode() == ffi::Mode::Insert; }));
  EXPECT_FALSE(hints()->IsVisible()) << "one field: no labels needed";
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, YankLinkHint) {
  NavigateTo("/hints");
  PressLetter('y');
  ShowHints("f");
  base::RunLoop loop;
  controller()->set_page_work_done_callback_for_testing(loop.QuitClosure());
  PressLetter('s');  // "One"
  loop.Run();
  EXPECT_EQ(ReadClipboard(),
            base::UTF8ToUTF16(embedded_test_server()->GetURL("/one").spec()));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ClickingThePageDismissesHints) {
  NavigateTo("/hints");
  ShowHints("f");
  content::SimulateMouseClickAt(contents(), 0,
                                blink::WebMouseEvent::Button::kLeft,
                                gfx::Point(400, 400));
  ASSERT_TRUE(base::test::RunUntil([&] { return !hints()->IsVisible(); }));
  EXPECT_EQ(mode(), ffi::Mode::Normal);
}

// -- Phase 2: palette ---------------------------------------------------------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, TabSwitcherSwitchesTabs) {
  ui_test_utils::NavigateToURLWithDisposition(
      browser(), embedded_test_server()->GetURL("/hints"),
      WindowOpenDisposition::NEW_FOREGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP);
  ui_test_utils::NavigateToURLWithDisposition(
      browser(), embedded_test_server()->GetURL("/inner"),
      WindowOpenDisposition::NEW_FOREGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP);
  contents()->Focus();
  ASSERT_EQ(browser()->tab_strip_model()->active_index(), 2);

  PressLetter('b');
  ASSERT_TRUE(palette()->IsVisible());
  EXPECT_EQ(palette_view()->model().kind, ffi::PaletteKind::Tabs);
  ASSERT_EQ(palette_view()->model().rows.size(), 3u);
  // Most recent first: "hints" was active before "inner"; current is last.
  EXPECT_EQ(palette_view()->model().rows[0].primary, u"hints");
  EXPECT_TRUE(palette_view()->model().rows[2].active);

  TypeInPalette(u"modal", ui::VKEY_RETURN);
  EXPECT_EQ(browser()->tab_strip_model()->active_index(), 0);
  EXPECT_FALSE(palette()->IsVisible());
  EXPECT_EQ(mode(), ffi::Mode::Normal);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, TabSwitcherRowClick) {
  ui_test_utils::NavigateToURLWithDisposition(
      browser(), embedded_test_server()->GetURL("/hints"),
      WindowOpenDisposition::NEW_FOREGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP);
  contents()->Focus();
  PressLetter('b');
  ASSERT_TRUE(palette()->IsVisible());
  // Rows are buttons: clicking one switches, like Enter.
  controller()->OnPaletteRowClicked(0);
  EXPECT_EQ(browser()->tab_strip_model()->active_index(), 0);
  EXPECT_FALSE(palette()->IsVisible());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, CommandListRunsCommand) {
  PressQuestion();
  ASSERT_TRUE(palette()->IsVisible());
  EXPECT_EQ(palette_view()->model().kind, ffi::PaletteKind::Commands);
  TypeInPalette(u"new tab", ui::VKEY_UNKNOWN);
  ASSERT_FALSE(palette_view()->model().rows.empty());
  EXPECT_EQ(palette_view()->model().rows[0].primary, u"New tab");
  EXPECT_EQ(palette_view()->model().rows[0].keys, u"t");
  ui::KeyEvent enter(ui::EventType::kKeyPressed, ui::VKEY_RETURN, ui::EF_NONE);
  palette_view()->textfield()->OnKeyEvent(&enter);
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return browser()->tab_strip_model()->count() == 2; }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ClickingPageClosesPalette) {
  PressColon();
  ASSERT_TRUE(palette()->IsVisible());
  // Focus goes back to the page and a key arrives there.
  contents()->Focus();
  PressLetter('j');
  EXPECT_FALSE(palette()->IsVisible());
  EXPECT_EQ(mode(), ffi::Mode::Normal);
  ASSERT_TRUE(base::test::RunUntil([&] { return ScrollY() == 60; }));
}

// -- Phase 2: status, config, clipboard, scrolling -----------------------------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, WhichKeyAppearsAfterAPause) {
  PressLetter('g');
  EXPECT_EQ(status()->state().pending, u"g");
  EXPECT_FALSE(status()->PanelVisible()) << "not before the delay";
  ASSERT_TRUE(base::test::RunUntil([&] { return status()->PanelVisible(); }));
  bool has_top = false;
  for (const auto& [keys, desc] : status()->state().which_key) {
    has_top |= keys == u"g" && desc == u"Top of page";
  }
  EXPECT_TRUE(has_top);
  PressEscape();
  EXPECT_FALSE(status()->PanelVisible());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ConfigFileBindsAndUnbinds) {
  WriteConfig(R"(
[options]
scroll_step = 100
[keys.normal]
x = "tabnew"
[unmap]
normal = ["t"]
)");
  ReloadConfig();
  EXPECT_TRUE(status()->state().message.starts_with(u"Config reloaded: 1 bindings"))
      << status()->state().message;
  PressLetter('j');
  ASSERT_TRUE(base::test::RunUntil([&] { return ScrollY() == 100; }));
  PressLetter('t');
  ASSERT_TRUE(base::test::RunUntil([&] { return PageLog() == "t "; }))
      << "unmapped keys reach the page";
  PressLetter('x');
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return browser()->tab_strip_model()->count() == 2; }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ConfigErrorsAreShownWithLines) {
  WriteConfig("[options]\nscroll_step = 1\n");
  ReloadConfig();
  EXPECT_TRUE(status()->state().message_is_error);
  EXPECT_NE(status()->state().message.find(u"line 2:"), std::u16string::npos)
      << status()->state().message;
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, SitePassthroughFromConfig) {
  WriteConfig("[options]\npassthrough_sites = [\"127.0.0.1\"]\n");
  ReloadConfig();
  NavigateTo("/page");
  EXPECT_EQ(mode(), ffi::Mode::Passthrough);
  PressLetter('j');
  ASSERT_TRUE(base::test::RunUntil([&] { return PageLog() == "j "; }));
  EXPECT_EQ(ScrollY(), 0);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, YankUrlAndPasteOpen) {
  PressLetters("yy");
  EXPECT_EQ(ReadClipboard(),
            base::UTF8ToUTF16(contents()->GetLastCommittedURL().spec()));

  const GURL target = embedded_test_server()->GetURL("/pasted");
  ui::ScopedClipboardWriter(ui::ClipboardBuffer::kCopyPaste)
      .WriteText(base::UTF8ToUTF16(target.spec()));
  content::TestNavigationObserver navigation(contents());
  PressLetter('p');
  navigation.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL(), target);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, PasteRefusesScriptUrls) {
  ui::ScopedClipboardWriter(ui::ClipboardBuffer::kCopyPaste)
      .WriteText(u"javascript:alert(1)");
  PressLetter('p');
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return status()->state().message_is_error; }));
  EXPECT_EQ(contents()->GetLastCommittedURL().path(), "/page");
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, JScrollsInnerPanel) {
  NavigateTo("/inner");
  PressLetter('j');
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(),
                           "document.getElementById('panel').scrollTop") == 60;
  }));
  PressLetter('G');
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(),
                           "document.getElementById('panel').scrollTop > 1000")
        .ExtractBool();
  }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, GuGoesUpOneLevel) {
  NavigateTo("/a/b/c?q=1");
  content::TestNavigationObserver navigation(contents());
  PressLetters("gu");
  navigation.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL().path(), "/a/b/");
}

// -- Phase 2: browser shell ---------------------------------------------------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, TabsStartInASidebar) {
  auto* state = tabs::VerticalTabStripStateController::From(browser());
  ASSERT_TRUE(state);
  EXPECT_TRUE(state->ShouldDisplayVerticalTabs());
  // Only the default changed: nothing is written as the user's choice.
  EXPECT_FALSE(browser()->GetProfile()->GetPrefs()->HasPrefPath(
      prefs::kVerticalTabsEnabled));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, VerticalTabsCommandAndConfig) {
  auto* state = tabs::VerticalTabStripStateController::From(browser());
  PrefService* prefs = browser()->GetProfile()->GetPrefs();

  // The config default switches the layout live.
  WriteConfig("[options]\nvertical_tabs = false\n");
  ReloadConfig();
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return !state->ShouldDisplayVerticalTabs(); }));

  // The command records the user's choice, which then beats the config.
  controller()->RunCommandLine("vertical-tabs on");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return state->ShouldDisplayVerticalTabs(); }));
  EXPECT_TRUE(prefs->HasPrefPath(prefs::kVerticalTabsEnabled));
  ReloadConfig();
  EXPECT_TRUE(state->ShouldDisplayVerticalTabs())
      << "config never overrides a layout the user picked";
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, HideTabsCommandAndConfig) {
  BrowserView* view = BrowserView::GetBrowserViewForBrowser(browser());
  ASSERT_TRUE(view->ShouldDrawTabStrip());

  controller()->RunCommandLine("hide-tabs");
  EXPECT_TRUE(controller()->TabsHidden());
  EXPECT_FALSE(view->ShouldDrawTabStrip());
  ASSERT_TRUE(base::test::RunUntil([&] {
    return !view->tab_strip_view() || !view->tab_strip_view()->GetVisible();
  }));

  // A reload that leaves hide_tabs alone keeps the window's choice.
  ReloadConfig();
  EXPECT_TRUE(controller()->TabsHidden());

  controller()->RunCommandLine("hide-tabs off");
  EXPECT_TRUE(view->ShouldDrawTabStrip());

  // The config's value applies when it changes.
  WriteConfig("[options]\nhide_tabs = true\n");
  ReloadConfig();
  EXPECT_TRUE(controller()->TabsHidden());
  WriteConfig("[options]\nhide_tabs = false\n");
  ReloadConfig();
  EXPECT_FALSE(controller()->TabsHidden());
  EXPECT_TRUE(view->ShouldDrawTabStrip());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, GsCollapsesAndExpandsSidebar) {
  auto* state = tabs::VerticalTabStripStateController::From(browser());
  ASSERT_TRUE(state->ShouldDisplayVerticalTabs());
  const bool collapsed = state->IsCollapsed();
  PressLetters("gs");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return state->IsCollapsed() != collapsed; }));
  PressLetters("gs");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return state->IsCollapsed() == collapsed; }));
  EXPECT_EQ(PageLog(), "") << "gs is a command, not page input";
}

// -- Merlin redesign -------------------------------------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, NewTabsOpenMerlinStartPage) {
  // Something for each list: a saved workspace and a closed page.
  NavigateTo("/hints");
  RunAndWait("workspace save research");
  ui_test_utils::NavigateToURLWithDisposition(
      browser(), embedded_test_server()->GetURL("/modal"),
      WindowOpenDisposition::NEW_FOREGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP);
  browser()->tab_strip_model()->CloseWebContentsAt(
      browser()->tab_strip_model()->active_index(),
      TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);

  ui_test_utils::NavigateToURLWithDisposition(
      browser(), GURL(chrome::kChromeUINewTabURL),
      WindowOpenDisposition::NEW_FOREGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP);
  // Chromium rewrites chrome://newtab to the override and keeps
  // chrome://newtab as the address, so check what loaded, not the URL.
  EXPECT_EQ(content::EvalJs(contents(), "document.title"), "Start");
  ASSERT_TRUE(contents()->GetWebUI());
  EXPECT_TRUE(
      contents()->GetWebUI()->GetController()->GetAs<MerlinStartUI>());

  // The handler answers the page's request for its lists.
  auto list_text = [&](const char* id) {
    return content::EvalJs(contents(), std::string("document.getElementById('") +
                                           id + "').textContent")
        .ExtractString();
  };
  ASSERT_TRUE(base::test::RunUntil([&] {
    return list_text("ws").find("research") != std::string::npos &&
           list_text("rc").find("modal") != std::string::npos;
  })) << list_text("ws") << " | " << list_text("rc");

  // A new tab starts with the cursor in the field.
  EXPECT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(), "document.activeElement.id") == "q";
  }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, PageCardAndTabLayout) {
  BrowserView* view = BrowserView::GetBrowserViewForBrowser(browser());
  StatusHost* host = controller()->status_for_testing();
  EXPECT_TRUE(view->multi_contents_view()->IsShowingCard());
  // No bar under the page: in Normal mode with nothing to report, no status
  // shows at all.
  EXPECT_TRUE(!host->widget_for_testing() ||
              !host->widget_for_testing()->IsVisible());

  NavigateTo("/hints");
  auto* state = tabs::VerticalTabStripStateController::From(browser());
  ASSERT_TRUE(state->ShouldDisplayVerticalTabs());
  // Sidebar: Merlin's address field replaces Chromium's.
  MerlinAddressField* field = controller()->address_field_for_testing();
  ASSERT_TRUE(field);
  EXPECT_FALSE(view->GetLocationBarView()->GetVisible());
  EXPECT_TRUE(field->GetVisible());
  EXPECT_EQ(field->rest_for_testing(), u"/hints");

  EXPECT_EQ(controller()->RunCommandLine("set tabs=top"), "");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return !state->ShouldDisplayVerticalTabs(); }));
  // Tabs on top: the same.
  EXPECT_FALSE(view->GetLocationBarView()->GetVisible());
  EXPECT_TRUE(field->GetVisible());

  EXPECT_EQ(controller()->RunCommandLine("set tabs=side"), "");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return state->ShouldDisplayVerticalTabs(); }));
  EXPECT_FALSE(view->GetLocationBarView()->GetVisible());
}

// -- Round 2: no trace of Chromium -------------------------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinMarksReplaceChromiumLogo) {
  // The product logo Settings › About shows (chrome://theme/current-channel-
  // logo) is the approved rust falcon on cream. Chromium's logo is
  // white and blue at these same sample points.
  const gfx::ImageSkia* logo =
      ui::ResourceBundle::GetSharedInstance().GetImageSkiaNamed(
          IDR_PRODUCT_LOGO_32);
  ASSERT_TRUE(logo);
  const SkBitmap& bitmap = logo->GetRepresentation(1.0f).GetBitmap();
  ASSERT_EQ(bitmap.width(), 32);
  EXPECT_EQ(bitmap.getColor(16, 3), SkColorSetRGB(0xF5, 0xE9, 0xD7));
  EXPECT_EQ(bitmap.getColor(16, 16), SkColorSetRGB(0xAA, 0x4C, 0x32));

  // chrome://version shows the Merlin wordmark (112 x 32, where Chromium's
  // is 171 x 32) and Merlin's own credit lines.
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(),
                                           GURL(chrome::kChromeUIVersionURL)));
  const std::string ratio =
      "(() => { const i = document.querySelector('#logo img');"
      "  return i.complete && i.naturalHeight ?"
      "      Math.round(100 * i.naturalWidth / i.naturalHeight) : 0; })()";
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return content::EvalJs(contents(), ratio).ExtractInt() > 0; }));
  EXPECT_EQ(content::EvalJs(contents(), ratio).ExtractInt(), 350);
  const std::string header =
      content::EvalJs(contents(),
                      "document.getElementById('company').textContent + ' ' +"
                      "document.getElementById('copyright').textContent")
          .ExtractString();
  EXPECT_EQ(header.find("Chromium"), std::string::npos) << header;
  EXPECT_NE(header.find("Merlin"), std::string::npos) << header;
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinUrlsInBarAndPalette) {
  EXPECT_EQ(MerlinDisplayUrl(GURL("chrome://settings/passwords?q=a#b")),
            "merlin://settings/passwords?q=a#b");
  EXPECT_EQ(MerlinDisplayUrl(GURL("chrome://merlin-start/")),
            "merlin://start");
  EXPECT_EQ(MerlinDisplayUrl(GURL("chrome://newtab/")), "merlin://start");
  EXPECT_EQ(MerlinDisplayUrl(GURL("https://example.com/chrome://x")),
            "https://example.com/chrome://x");

  // Typed merlin:// opens the real chrome:// page.
  content::TestNavigationObserver nav(contents());
  EXPECT_EQ(controller()->RunCommandLine("open merlin://version"), "");
  nav.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL(),
            GURL(chrome::kChromeUIVersionURL));

  // The address field shows it as merlin://.
  MerlinAddressField* field = controller()->address_field_for_testing();
  ASSERT_TRUE(field);
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return field->host_for_testing() == u"merlin://version"; }))
      << field->host_for_testing();

  // The tab switcher lists it the same way.
  bool listed = false;
  for (const TabEntry& tab : controller()->GetTabs()) {
    listed |= tab.url == "merlin://version";
  }
  EXPECT_TRUE(listed);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       MerlinAddressCardInternalAliases) {
  auto* editor = controller()->address_editor_for_testing();
  ASSERT_TRUE(editor);
  const std::pair<std::u16string, GURL> aliases[] = {
      {u"merlin://version", GURL("chrome://version/")},
      {u"merlin://settings", GURL("chrome://settings/")},
      {u"merlin://settings/keys", GURL("chrome://settings/keys")},
      {u"merlin://start", GURL("chrome://merlin-start/")},
      {u"  MERLIN://version/?q=a#b  ", GURL("chrome://version/?q=a#b")},
  };
  for (const auto& [typed, expected] : aliases) {
    NavigateTo("/page");
    controller()->FocusAddressBar();
    ASSERT_TRUE(editor->editing());
    views::Textfield* input = editor->textfield_for_testing();
    ASSERT_TRUE(input);
    input->SelectAll(false);
    input->InsertOrReplaceText(typed);
    content::TestNavigationObserver navigation(contents());
    ui::KeyEvent enter(ui::EventType::kKeyPressed, ui::VKEY_RETURN,
                       ui::EF_NONE);
    input->OnKeyEvent(&enter);
    navigation.Wait();
    EXPECT_EQ(contents()->GetLastCommittedURL(), expected);
    EXPECT_FALSE(editor->editing());

    // Reopening the card shows the same alias as the passive address field.
    if (expected.host() != "merlin-start") {
      controller()->FocusAddressBar();
      ASSERT_TRUE(editor->editing());
      EXPECT_EQ(input->GetText(),
                base::UTF8ToUTF16(MerlinDisplayUrl(expected)));
      EXPECT_EQ(input->GetSelectedText(), input->GetText());
      editor->End();
    }
  }

  // Ordinary URLs retain Chromium classification and native Enter behavior.
  NavigateTo("/page");
  controller()->FocusAddressBar();
  auto* input = editor->textfield_for_testing();
  input->SelectAll(false);
  const GURL target = embedded_test_server()->GetURL("/target");
  input->InsertOrReplaceText(base::UTF8ToUTF16(target.spec()));
  content::TestNavigationObserver navigation(contents());
  ui::KeyEvent enter(ui::EventType::kKeyPressed, ui::VKEY_RETURN, ui::EF_NONE);
  input->OnKeyEvent(&enter);
  navigation.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL(), target);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       MerlinInternalAddressSuggestions) {
  std::vector<MerlinSuggestions::Suggestion> results;
  MerlinSuggestions suggestions(
      browser()->GetProfile(),
      base::BindRepeating(
          [](std::vector<MerlinSuggestions::Suggestion>* output,
             const std::vector<MerlinSuggestions::Suggestion>& incoming) {
            *output = incoming;
          },
          &results));
  suggestions.Query(u"merlin://version", false);
  ASSERT_TRUE(base::test::RunUntil([&] { return !results.empty(); }));
  EXPECT_EQ(results.front().destination, GURL("chrome://version/"));
  EXPECT_NE(results.front().kind, MerlinSuggestions::Kind::kSearch);
  EXPECT_EQ(results.front().detail, u"merlin://version");
  EXPECT_TRUE(results.front().inline_completion.empty());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       MerlinAddressSuggestionsAccessibility) {
  controller()->FocusAddressBar();
  auto* editor = controller()->address_editor_for_testing();
  ASSERT_TRUE(editor);
  ASSERT_TRUE(editor->editing());
  auto* input = editor->textfield_for_testing();
  auto* list = editor->suggestions_for_testing();
  ASSERT_TRUE(input);
  ASSERT_TRUE(list);
  auto* focus = input->GetFocusManager();
  EXPECT_EQ(focus->GetStoredFocusView(), input);
  const GURL target = embedded_test_server()->GetURL("/target");
  const std::vector<MerlinSuggestions::Suggestion> results = {
      {.kind = MerlinSuggestions::Kind::kSearch,
       .title = u"Search documentation",
       .destination = target},
      {.kind = MerlinSuggestions::Kind::kUrl,
       .title = u"Example docs",
       .detail = u"example.test/docs",
       .destination = target},
      {.kind = MerlinSuggestions::Kind::kTab,
       .title = u"Existing tab",
       .detail = u"example.test/tab",
       .destination = target},
  };
  views::test::AXEventCounter events(views::AXUpdateNotifier::Get());
  MerlinAddressEditorTestPeer::Results(*editor, results);
  ASSERT_EQ(list->children().size(), 3u);
  EXPECT_TRUE(list->GetVisible());
  ui::AXNodeData field_data;
  input->GetViewAccessibility().GetAccessibleNodeData(&field_data);
  EXPECT_TRUE(field_data.HasState(ax::mojom::State::kExpanded));
  EXPECT_EQ(
      field_data.GetIntListAttribute(ax::mojom::IntListAttribute::kControlsIds),
      std::vector<int32_t>{list->GetViewAccessibility().GetUniqueId()});
  EXPECT_EQ(input->GetViewAccessibility().GetActiveDescendantView(),
            &list->children()[0]->GetViewAccessibility());
  for (size_t i = 0; i < list->children().size(); ++i) {
    ui::AXNodeData option;
    list->children()[i]->GetViewAccessibility().GetAccessibleNodeData(&option);
    EXPECT_EQ(option.role, ax::mojom::Role::kListBoxOption);
    EXPECT_FALSE(list->children()[i]->GetViewAccessibility().GetIsIgnored());
    EXPECT_EQ(option.GetBoolAttribute(ax::mojom::BoolAttribute::kSelected),
              i == 0);
    EXPECT_EQ(option.GetIntAttribute(ax::mojom::IntAttribute::kPosInSet),
              static_cast<int>(i + 1));
    EXPECT_EQ(option.GetIntAttribute(ax::mojom::IntAttribute::kSetSize), 3);
    EXPECT_FALSE(list->children()[i]->bounds().IsEmpty());
  }
  ui::AXNodeData tab_data;
  list->children()[2]->GetViewAccessibility().GetAccessibleNodeData(&tab_data);
  EXPECT_EQ(tab_data.GetString16Attribute(ax::mojom::StringAttribute::kName),
            u"Existing tab, example.test/tab, Switch to tab");

  views::View* second = list->children()[1];
  events.ResetAllCounts();
  ui::KeyEvent down(ui::EventType::kKeyPressed, ui::VKEY_DOWN, ui::EF_NONE);
  input->OnKeyEvent(&down);
  EXPECT_EQ(input->GetViewAccessibility().GetActiveDescendantView(),
            &second->GetViewAccessibility());
  EXPECT_EQ(list->children()[1], second);
  EXPECT_GT(events.GetCount(ax::mojom::Event::kActiveDescendantChanged, input),
            0);
  EXPECT_GT(events.GetCount(ax::mojom::Event::kSelection, second), 0);
  EXPECT_EQ(focus->GetStoredFocusView(), input);

  // New results at the same selected index must still be announced.
  events.ResetAllCounts();
  auto updated = results;
  updated[1].title = u"Updated documentation";
  MerlinAddressEditorTestPeer::Results(*editor, updated);
  EXPECT_EQ(list->children()[1], second);
  EXPECT_GT(events.GetCount(ax::mojom::Event::kActiveDescendantChanged, input),
            0);

  ui::AXActionData select;
  select.action = ax::mojom::Action::kFocus;
  EXPECT_TRUE(list->children()[2]->HandleAccessibleAction(select));
  EXPECT_EQ(input->GetViewAccessibility().GetActiveDescendantView(),
            &list->children()[2]->GetViewAccessibility());
  EXPECT_EQ(focus->GetStoredFocusView(), input);

  // Shrinking/replacing results must not leave a dangling active option.
  MerlinAddressEditorTestPeer::Results(*editor, {results[1]});
  ASSERT_EQ(list->children().size(), 1u);
  EXPECT_EQ(input->GetViewAccessibility().GetActiveDescendantView(),
            &list->children()[0]->GetViewAccessibility());
  ui::KeyEvent escape(ui::EventType::kKeyPressed, ui::VKEY_ESCAPE, ui::EF_NONE);
  input->OnKeyEvent(&escape);
  EXPECT_FALSE(editor->editing());
  EXPECT_TRUE(list->children().empty());
  EXPECT_FALSE(list->GetVisible());
  EXPECT_EQ(input->GetViewAccessibility().GetActiveDescendantView(), nullptr);
  input->GetViewAccessibility().GetAccessibleNodeData(&field_data);
  EXPECT_TRUE(field_data.HasState(ax::mojom::State::kCollapsed));
  EXPECT_FALSE(field_data.HasIntListAttribute(
      ax::mojom::IntListAttribute::kControlsIds));

  // Screen-reader activation follows the same real navigation as a row click.
  controller()->FocusAddressBar();
  MerlinAddressEditorTestPeer::Results(*editor, {results[1]});
  content::TestNavigationObserver navigation(contents());
  ui::AXActionData activate;
  activate.action = ax::mojom::Action::kDoDefault;
  EXPECT_TRUE(list->children()[0]->HandleAccessibleAction(activate));
  navigation.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL(), target);
}

// -- Round 2: Merlin's own pages, menu and restyling ------------------------

namespace {

std::string Text(content::WebContents* contents, const std::string& script) {
  return content::EvalJs(contents, script).ExtractString();
}

}  // namespace

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinSettingsReplacesSettings) {
  // Chromium keeps the typed chrome://settings as the address after the
  // rewrite (as for the new tab page), so check what loaded.
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://settings")));
  ASSERT_TRUE(contents()->GetWebUI()->GetController()->GetAs<MerlinSettingsUI>());
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(),
                           "document.querySelectorAll('section').length")
               .ExtractInt() == 9;
  }));
  // No Google account, sync or AI sections. (The search engine list may
  // name Google: it is the user's choice.)
  const std::string nav = Text(contents(), "document.getElementById('nav').innerText");
  EXPECT_EQ(nav.find("Google"), std::string::npos) << nav;
  EXPECT_EQ(nav.find("Chrome"), std::string::npos) << nav;
  EXPECT_EQ(nav.find("AI"), std::string::npos) << nav;
  EXPECT_NE(nav.find("About Merlin"), std::string::npos);
  EXPECT_NE(nav.find("Ad blocking"), std::string::npos);

  // chrome://settings/help opens on About; sync goes to Merlin Settings.
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://settings/help")));
  ASSERT_TRUE(contents()->GetWebUI()->GetController()->GetAs<MerlinSettingsUI>());
  EXPECT_TRUE(base::test::RunUntil([&] {
    return Text(contents(),
                "document.querySelector('#nav [aria-current=\"true\"]')?.dataset.id || ''") ==
           "about";
  }));
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://settings/syncSetup")));
  EXPECT_TRUE(contents()->GetWebUI()->GetController()->GetAs<MerlinSettingsUI>());
  EXPECT_EQ(MerlinSettingsUI::LinkTarget("site-permissions"), "chrome://settings/content");
  EXPECT_EQ(MerlinSettingsUI::LinkTarget("javascript:alert(1)"), "");

  // Security pages stay Chromium's, with its section menu hidden.
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://settings/content")));
  EXPECT_FALSE(contents()->GetWebUI()->GetController()->GetAs<MerlinSettingsUI>());
  EXPECT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(),
                           "(() => { const l = document.querySelector('settings-ui')"
                           "?.shadowRoot?.querySelector('#left');"
                           " return !!l && l.style.display === 'none'; })()")
        .ExtractBool();
  }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinSettingsChangesPreferences) {
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://settings")));
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(), "!!document.getElementById('appearance')")
        .ExtractBool();
  }));
  Profile* profile = browser()->GetProfile();
  ASSERT_TRUE(content::ExecJs(contents(), "chrome.send('setTheme', [2])"));
  ASSERT_TRUE(content::ExecJs(contents(), "chrome.send('setAskWhere', [true])"));
  ASSERT_TRUE(content::ExecJs(contents(), "chrome.send('setStartup', ['last'])"));
  ASSERT_TRUE(base::test::RunUntil([&] {
    return profile->GetPrefs()->GetBoolean(prefs::kPromptForDownload);
  }));
  EXPECT_EQ(ThemeServiceFactory::GetForProfile(profile)->GetBrowserColorScheme(),
            ThemeService::BrowserColorScheme::kDark);
  EXPECT_EQ(SessionStartupPref::GetStartupPref(profile).type,
            SessionStartupPref::LAST);
  // Out-of-range values are ignored.
  ASSERT_TRUE(content::ExecJs(contents(), "chrome.send('setTheme', [7])"));
  ASSERT_TRUE(content::ExecJs(contents(), "chrome.send('setZoom', [33])"));
  EXPECT_EQ(ThemeServiceFactory::GetForProfile(profile)->GetBrowserColorScheme(),
            ThemeService::BrowserColorScheme::kDark);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinHistoryPage) {
  history::HistoryService* history = HistoryServiceFactory::GetForProfile(
      browser()->GetProfile(), ServiceAccessType::EXPLICIT_ACCESS);
  history->AddPage(GURL("https://merlin-history.test/"), base::Time::Now(),
                   history::SOURCE_BROWSED);
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://history")));
  ASSERT_TRUE(contents()->GetWebUI()->GetController()->GetAs<MerlinHistoryUI>());
  EXPECT_TRUE(base::test::RunUntil([&] {
    return Text(contents(), "document.getElementById('list').innerText")
               .find("merlin-history.test") != std::string::npos;
  }));
  EXPECT_EQ(MerlinDisplayUrl(GURL("chrome://merlin-history/")), "merlin://history");
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinDownloadsPage) {
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://downloads")));
  ASSERT_TRUE(contents()->GetWebUI()->GetController()->GetAs<MerlinDownloadsUI>());
  EXPECT_TRUE(base::test::RunUntil([&] {
    return Text(contents(), "document.getElementById('list').innerText")
               .find("No downloads yet") != std::string::npos;
  }));
  // Chromium's page stays reachable for reviewing held-back files.
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://downloads/?classic")));
  EXPECT_FALSE(contents()->GetWebUI()->GetController()->GetAs<MerlinDownloadsUI>());
  // The bubble no longer pops open on its own.
  EXPECT_FALSE(browser()->GetProfile()->GetPrefs()->GetBoolean(
      prefs::kDownloadBubblePartialViewEnabled));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinBookmarksPage) {
  bookmarks::BookmarkModel* model =
      BookmarkModelFactory::GetForBrowserContext(browser()->GetProfile());
  ASSERT_TRUE(base::test::RunUntil([&] { return model->loaded(); }));
  model->AddURL(model->other_node(), 0, u"Merlin field guide",
                GURL("https://guide.test/"));
  ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL("chrome://bookmarks")));
  ASSERT_TRUE(contents()->GetWebUI()->GetController()->GetAs<MerlinBookmarksUI>());
  ASSERT_TRUE(content::ExecJs(
      contents(), "location.hash = '" +
                      base::NumberToString(model->other_node()->id()) + "'"));
  EXPECT_TRUE(base::test::RunUntil([&] {
    return Text(contents(), "document.getElementById('list').innerText")
               .find("Merlin field guide") != std::string::npos;
  }));
  // Search finds it from the top level, and renaming goes to the model.
  const std::string id = base::NumberToString(model->other_node()->children()[0]->id());
  ASSERT_TRUE(content::ExecJs(
      contents(), "chrome.send('edit', ['" + id + "', 'Renamed', 'https://guide.test/'])"));
  EXPECT_TRUE(base::test::RunUntil([&] {
    return model->other_node()->children()[0]->GetTitle() == u"Renamed";
  }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinMenuReplacesChromiumMenu) {
  // ⋮ and the account button are gone.
  BrowserElementsViews* elements = BrowserElementsViews::From(browser());
  ASSERT_TRUE(elements);
  // ⋮ and the account button take 1 px, transparent, but stay drawn: bubbles anchor
  // to them, and AppMenuButton::GetAnchor() CHECKs on a fallback that does
  // not exist yet at startup ("Restore pages?" after a crash).
  views::View* menu = elements->GetView(kToolbarAppMenuButtonElementId);
  ASSERT_TRUE(menu);
  ASSERT_TRUE(base::test::RunUntil([&] { return menu->width() <= 1; }))
      << "width " << menu->width() << " parent " << menu->parent()->GetClassName()
      << " layout " << (menu->parent()->GetLayoutManager() ? "yes" : "no")
      << " flex " << !!menu->GetProperty(views::kFlexBehaviorKey)
      << " focus " << static_cast<int>(menu->GetFocusBehavior())
      << " visible " << menu->GetVisible();
  EXPECT_TRUE(menu->IsDrawn());
  views::View* avatar = elements->GetView(kToolbarAvatarButtonElementId);
  EXPECT_TRUE(!avatar || avatar->width() <= 1);

  EXPECT_EQ(controller()->RunCommandLine("palette menu"), "");
  ASSERT_TRUE(palette()->IsVisible());
  EXPECT_EQ(palette_view()->model().kind, ffi::PaletteKind::Menu);
  PressEscape();

  // :browser runs the actions the menu offered.
  EXPECT_EQ(controller()->RunCommandLine("browser zoom-in"), "");
  EXPECT_TRUE(base::test::RunUntil([&] {
    return zoom::ZoomController::FromWebContents(contents())->GetZoomPercent() > 100;
  }));
  EXPECT_EQ(controller()->RunCommandLine("browser zoom-reset"), "");
  EXPECT_NE(controller()->RunCommandLine("browser explode"), "");
  // AI Mode in the address field is off unless the user turns it on.
  EXPECT_EQ(browser()->GetProfile()->GetPrefs()->GetInteger(omnibox::kAIModeSettings), 1);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MerlinToolbarFollowsPage) {
  EXPECT_EQ(controller()->RunCommandLine("set tabs=top"), "");
  auto* state = tabs::VerticalTabStripStateController::From(browser());
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return !state->ShouldDisplayVerticalTabs(); }));
  BrowserView* view = BrowserView::GetBrowserViewForBrowser(browser());
  // The state changes before the scheduled layout removes the native WebUI
  // toolbar's width. Measure the completed layout, not its previous bounds.
  view->GetWidget()->LayoutRootViewIfNecessary();
  EXPECT_FALSE(view->GetLocationBarView()->GetVisible());
  BrowserElementsViews* elements = BrowserElementsViews::From(browser());
  views::View* tab_search = elements->GetView(kTabSearchButtonElementId);
  EXPECT_TRUE(!tab_search || !tab_search->GetVisible());
  // Chromium's back, forward and reload are native buttons or, with the
  // WebUI toolbar buttons on, one web view; either way, hidden.
  int chromium_nav = 0;
  for (views::View* child : view->GetLocationBarView()->parent()->children()) {
    const std::string_view name = child->GetClassName();
    if (name == "WebUIToolbarWebView" || name == "BackForwardButton" ||
        name == "ReloadButton") {
      ++chromium_nav;
      // Hidden, or (the WebUI view, which must stay in the layout) no width.
      EXPECT_TRUE(!child->GetVisible() || child->width() == 0) << name;
    }
  }
  EXPECT_GT(chromium_nav, 0);
  MerlinAddressField* field = controller()->address_field_for_testing();
  MerlinNavButton* back = controller()->back_button_for_testing();
  ASSERT_TRUE(field);
  ASSERT_TRUE(back);
  EXPECT_TRUE(back->GetVisible());

  // A new tab opens the start page: no address field (the page has its
  // own) and no command line popping up (Chromium focuses the address
  // field for new tabs).
  ui_test_utils::NavigateToURLWithDisposition(
      browser(), GURL(chrome::kChromeUINewTabURL),
      WindowOpenDisposition::NEW_FOREGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP);
  base::RunLoop().RunUntilIdle();
  EXPECT_FALSE(palette()->IsVisible());
  EXPECT_FALSE(field->GetVisible());
  EXPECT_FALSE(back->GetEnabled());

  // On a site the field shows the address: host, then the dimmed rest.
  NavigateTo("/page");
  EXPECT_TRUE(field->GetVisible());
  EXPECT_TRUE(base::StartsWith(field->host_for_testing(), u"127.0.0.1"))
      << field->host_for_testing();
  EXPECT_EQ(field->rest_for_testing(), u"/page");
  EXPECT_TRUE(back->GetEnabled());

  // Clicking it opens the address card, focused with the address selected.
  ui::MouseEvent click(ui::EventType::kMousePressed,
                       field->GetLocalBounds().CenterPoint(),
                       field->GetLocalBounds().CenterPoint(),
                       ui::EventTimeForNow(), ui::EF_LEFT_MOUSE_BUTTON,
                       ui::EF_LEFT_MOUSE_BUTTON);
  views::test::ButtonTestApi(field).NotifyClick(click);
  views::Textfield* address_input = nullptr;
  ASSERT_TRUE(base::test::RunUntil([&] {
    address_input = views::AsViewClass<views::Textfield>(
        view->GetFocusManager()->GetStoredFocusView());
    return address_input && address_input->GetWidget()->IsVisible();
  }));
  EXPECT_FALSE(palette()->IsVisible());
  EXPECT_NE(address_input->GetText().find(field->host_for_testing()),
            std::u16string::npos);
  EXPECT_TRUE(base::EndsWith(address_input->GetText(), u"/page"));
  EXPECT_EQ(address_input->GetSelectedText(), address_input->GetText());
  ui::KeyEvent escape(ui::EventType::kKeyPressed, ui::VKEY_ESCAPE, ui::EF_NONE);
  address_input->OnKeyEvent(&escape);
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return !address_input->GetWidget()->IsVisible(); }));
  ASSERT_TRUE(base::test::RunUntil([&] { return field->GetVisible(); }));

  // Its "Not secure" tag opens the site's page info, though Chromium's
  // field (its usual anchor) is hidden.
  const gfx::Point tag(20, field->height() / 2);
  ui::MouseEvent tag_click(ui::EventType::kMousePressed, tag, tag,
                           ui::EventTimeForNow(), ui::EF_LEFT_MOUSE_BUTTON,
                           ui::EF_LEFT_MOUSE_BUTTON);
  views::test::ButtonTestApi(field).NotifyClick(tag_click);
  ASSERT_TRUE(base::test::RunUntil([] {
    return PageInfoBubbleViewBase::GetPageInfoBubbleForTesting() != nullptr;
  }));
  EXPECT_FALSE(palette()->IsVisible());
  PageInfoBubbleViewBase::GetPageInfoBubbleForTesting()->GetWidget()->CloseNow();

  // Back returns to the start page, and the field goes again.
  content::TestNavigationObserver nav(contents());
  views::test::ButtonTestApi(back).NotifyClick(click);
  nav.Wait();
  ASSERT_TRUE(base::test::RunUntil([&] { return !field->GetVisible(); }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ErrorPagesAreRestyled) {
  ASSERT_TRUE(ui_test_utils::NavigateToURL(
      browser(), GURL("http://127.0.0.1:1/")));
  ASSERT_TRUE(contents()->GetPrimaryMainFrame()->IsErrorDocument());
  EXPECT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(), "!!document.getElementById('merlin-style')")
        .ExtractBool();
  }));
}

// -- Snapshots ---------------------------------------------------------------

// Writes PNGs of the palette, status and hint surfaces to
// $MODAL_SNAPSHOT_DIR for visual review. Skipped when the variable is unset.
IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, Snapshots) {
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  std::optional<std::string> dir = env->GetVar("MODAL_SNAPSHOT_DIR");
  if (!dir || dir->empty()) {
    GTEST_SKIP() << "set MODAL_SNAPSHOT_DIR to write snapshots";
  }
  auto save = [&](const SkBitmap& bitmap, const std::string& name) {
    base::ScopedAllowBlockingForTesting allow;
    std::optional<std::vector<uint8_t>> png =
        gfx::PNGCodec::EncodeBGRASkBitmap(bitmap, /*discard_transparency=*/false);
    ASSERT_TRUE(png);
    ASSERT_TRUE(base::WriteFile(base::FilePath(*dir).AppendASCII(name), *png));
  };
  // Paints a surface's whole widget (the helper needs a paint root).
  auto Snap = [](views::View* view) {
    return views::test::PaintViewToBitmap(view->GetWidget()->GetRootView());
  };
  // The page under the overlays, so the hint labels are seen in place.
  auto page_with = [&](views::View* overlay, const std::string& name) {
    base::test::TestFuture<const content::CopyFromSurfaceResult&> copy;
    contents()->GetRenderWidgetHostView()->CopyFromSurface(
        gfx::Rect(), gfx::Size(), base::Seconds(5), copy.GetCallback());
    ASSERT_TRUE(copy.Get().has_value());
    SkBitmap page = copy.Get()->bitmap;
    SkBitmap layer = Snap(overlay);
    SkCanvas canvas(page);
    const float scale =
        static_cast<float>(page.width()) / std::max(1, overlay->width());
    canvas.scale(scale, scale);
    canvas.drawImage(layer.asImage(), 0, 0);
    save(page, name);
  };

  ui_test_utils::NavigateToURLWithDisposition(
      browser(), embedded_test_server()->GetURL("/hints"),
      WindowOpenDisposition::NEW_FOREGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP);
  contents()->Focus();

  ShowHints("f");
  page_with(hints()->view_for_testing(), "hints.png");
  PressEscape();

  PressLetter('b');
  save(Snap(palette_view()), "palette_tabs.png");
  TypeInPalette(u"hin", ui::VKEY_UNKNOWN);
  save(Snap(palette_view()),
       "palette_tabs_filtered.png");
  TypeInPalette(u"", ui::VKEY_ESCAPE);

  PressQuestion();
  save(Snap(palette_view()), "palette_commands.png");
  TypeInPalette(u"tab", ui::VKEY_UNKNOWN);
  ui::KeyEvent down(ui::EventType::kKeyPressed, ui::VKEY_DOWN, ui::EF_NONE);
  palette_view()->textfield()->OnKeyEvent(&down);
  save(Snap(palette_view()),
       "palette_commands_filtered.png");
  TypeInPalette(u"", ui::VKEY_ESCAPE);

  PressColon();
  TypeInPalette(u"tabnw", ui::VKEY_RETURN);
  save(Snap(palette_view()), "palette_error.png");
  TypeInPalette(u"sc", ui::VKEY_UNKNOWN);
  save(Snap(palette_view()), "palette_cmdline.png");
  TypeInPalette(u"", ui::VKEY_ESCAPE);

  PressLetter('g');
  ASSERT_TRUE(base::test::RunUntil([&] { return status()->PanelVisible(); }));
  save(Snap(status()), "status_which_key.png");
  PressEscape();

  PressLetter('i');
  save(Snap(status()), "status_insert.png");
  PressEscape();

  // The same surfaces in dark mode (Chrome's own appearance setting).
  ThemeServiceFactory::GetForProfile(browser()->GetProfile())
      ->SetBrowserColorScheme(ThemeService::BrowserColorScheme::kDark);
  base::RunLoop().RunUntilIdle();
  ShowHints("f");
  page_with(hints()->view_for_testing(), "dark_hints.png");
  PressEscape();
  PressQuestion();
  TypeInPalette(u"tab", ui::VKEY_UNKNOWN);
  save(Snap(palette_view()), "dark_palette_commands.png");
  TypeInPalette(u"", ui::VKEY_ESCAPE);
  PressLetter('b');
  save(Snap(palette_view()), "dark_palette_tabs.png");
  TypeInPalette(u"", ui::VKEY_ESCAPE);
  PressColon();
  TypeInPalette(u"tabnw", ui::VKEY_RETURN);
  save(Snap(palette_view()), "dark_palette_error.png");
  TypeInPalette(u"", ui::VKEY_ESCAPE);
  PressLetter('g');
  ASSERT_TRUE(base::test::RunUntil([&] { return status()->PanelVisible(); }));
  save(Snap(status()), "dark_status_which_key.png");
  PressEscape();
}


// -- Phase 3: splits, pins, workspaces, browserctl, external editor ----------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, VsplitShowsTwoPages) {
  TabStripModel* strip = browser()->tab_strip_model();
  const GURL doc = embedded_test_server()->GetURL("/doc");
  content::TestNavigationObserver navigation(doc);
  navigation.StartWatchingNewWebContents();
  EXPECT_EQ(controller()->RunCommandLine("vsplit " + doc.spec()), "");
  navigation.Wait();
  ASSERT_EQ(strip->count(), 2);
  EXPECT_EQ(strip->active_index(), 1);
  std::optional<split_tabs::SplitTabId> split = strip->GetSplitForTab(1);
  ASSERT_TRUE(split);
  EXPECT_EQ(strip->GetSplitForTab(0), split);
  EXPECT_EQ(strip->GetSplitData(*split)->visual_data()->split_layout(),
            split_tabs::SplitTabLayout::kSideBySide);

  // <C-w>w moves to the other side; <C-w>o ends the split.
  PressLetter('w', /*ctrl=*/true);
  PressLetter('w');
  EXPECT_EQ(strip->active_index(), 0);
  PressLetter('w', /*ctrl=*/true);
  PressLetter('o');
  EXPECT_FALSE(strip->GetSplitForTab(0));
  EXPECT_EQ(strip->count(), 2);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, GpPinsTheTab) {
  PressLetters("gp");
  EXPECT_TRUE(browser()->tab_strip_model()->IsTabPinned(0));
  PressLetters("gp");
  EXPECT_FALSE(browser()->tab_strip_model()->IsTabPinned(0));
}

// The Phase 3 gate's "save, relaunch, restore", within one run: save a
// window with a split, then open the workspace into a new window.
IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, WorkspaceSaveAndRestore) {
  EXPECT_EQ(
      controller()->RunCommandLine("workspace project /tmp/modal-project"), "");
  const GURL doc = embedded_test_server()->GetURL("/doc");
  content::TestNavigationObserver navigation(doc);
  navigation.StartWatchingNewWebContents();
  EXPECT_EQ(controller()->RunCommandLine("vsplit " + doc.spec()), "");
  navigation.Wait();
  // Pinning one side pins the split as a whole and keeps it.
  EXPECT_EQ(controller()->RunCommandLine("pin"), "");
  EXPECT_TRUE(browser()->tab_strip_model()->IsTabPinned(0));
  EXPECT_TRUE(browser()->tab_strip_model()->IsTabPinned(1));
  ASSERT_TRUE(browser()->tab_strip_model()->GetSplitForTab(0));
  // A third tab in the background, which restores without loading.
  const GURL form = embedded_test_server()->GetURL("/form");
  ASSERT_TRUE(ui_test_utils::NavigateToURLWithDisposition(
      browser(), form, WindowOpenDisposition::NEW_BACKGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP));

  RunAndWait("workspace save research");
  EXPECT_EQ(StatusMessage(), u"Saved workspace research (3 tabs)");
  EXPECT_EQ(controller()->workspace_for_testing(), "research");
  {
    base::ScopedAllowBlockingForTesting allow;
    std::string file;
    ASSERT_TRUE(base::ReadFileToString(
        workspace_store::PathFor("research"), &file));
    EXPECT_NE(file.find(doc.spec()), std::string::npos);
    EXPECT_NE(file.find("\"splits\""), std::string::npos);
  }

  // This window has real tabs, so the workspace opens in a new one.
  const size_t windows_before = GlobalBrowserCollection::GetInstance()->GetSize();
  RunAndWait("workspace open research");
  ASSERT_TRUE(base::test::RunUntil([&] {
    return GlobalBrowserCollection::GetInstance()->GetSize() ==
           windows_before + 1;
  }));
  BrowserWindowInterface* restored =
      GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser();
  ASSERT_NE(restored, browser());
  TabStripModel* strip = restored->GetTabStripModel();
  ASSERT_TRUE(base::test::RunUntil([&] { return strip->count() == 3; }));
  EXPECT_EQ(strip->GetTabAtIndex(1)->GetContents()->GetVisibleURL(), doc);
  // Restored lazily: the background tab has its URL but has not loaded.
  content::WebContents* lazy = strip->GetTabAtIndex(2)->GetContents();
  EXPECT_EQ(lazy->GetController().GetVisibleEntry()->GetURL(), form);
  EXPECT_TRUE(lazy->GetController().NeedsReload());
  EXPECT_TRUE(strip->IsTabPinned(0));
  EXPECT_TRUE(strip->GetSplitForTab(0));
  EXPECT_EQ(strip->GetSplitForTab(0), strip->GetSplitForTab(1));
  EXPECT_EQ(ModalBrowserController::From(restored)->workspace_for_testing(),
            "research");
  // A new window must retain the project through its next save, not just
  // restore the name and tabs. This is what workspace here matches later.
  RunAndWaitOn(ModalBrowserController::From(restored),
               "workspace save research");
  {
    base::ScopedAllowBlockingForTesting allow;
    std::string text;
    ASSERT_TRUE(
        base::ReadFileToString(workspace_store::PathFor("research"), &text));
    auto saved = base::JSONReader::Read(text, base::JSON_PARSE_RFC);
    ASSERT_TRUE(saved && saved->is_dict());
    ASSERT_TRUE(saved->GetDict().FindString("project"));
    EXPECT_EQ(*saved->GetDict().FindString("project"), "/tmp/modal-project");
  }
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, BrowserctlOverTheSocket) {
  ASSERT_TRUE(base::test::RunUntil([&] {
    return Browserctl(R"({"cmd":"ping"})").find("\"protocol\":1") !=
           std::string::npos;
  }));
  // open: a new tab, through the same URL rules as the command line.
  const GURL doc = embedded_test_server()->GetURL("/doc");
  content::TestNavigationObserver navigation(doc);
  navigation.StartWatchingNewWebContents();
  EXPECT_EQ(Browserctl(R"({"v":1,"id":5,"cmd":"open","url":")" + doc.spec() +
                       R"(","where":"tab"})"),
            "{\"v\":1,\"id\":5,\"ok\":true,\"result\":\"\"}\n");
  navigation.Wait();
  EXPECT_EQ(browser()->tab_strip_model()->count(), 2);

  // tabs: JSON with both pages.
  std::optional<base::Value> tabs =
      base::JSONReader::Read(Browserctl(R"({"cmd":"tabs"})"),
                             base::JSON_PARSE_RFC);
  ASSERT_TRUE(tabs && tabs->is_dict());
  const base::ListValue* list = tabs->GetDict().FindList("result");
  ASSERT_TRUE(list);
  ASSERT_EQ(list->size(), 2u);
  EXPECT_EQ(*(*list)[1].GetDict().FindString("url"), doc.spec());

  // focus and command go to the front window.
  EXPECT_NE(Browserctl(R"({"cmd":"focus","tab":1})").find("\"ok\":true"),
            std::string::npos);
  EXPECT_EQ(browser()->tab_strip_model()->active_index(), 0);
  EXPECT_NE(Browserctl(R"({"cmd":"command","line":"pin"})").find("\"ok\":true"),
            std::string::npos);
  EXPECT_TRUE(browser()->tab_strip_model()->IsTabPinned(0));

  // Refusals: script URLs, unknown commands, typos in command lines.
  EXPECT_NE(Browserctl(R"JSON({"cmd":"open","url":"javascript:alert(1)"})JSON")
                .find("\"ok\":false"),
            std::string::npos);
  EXPECT_NE(Browserctl(R"({"cmd":"rm"})").find("unknown command"),
            std::string::npos);
  EXPECT_NE(Browserctl(R"({"cmd":"command","line":"tabnw"})")
                .find("did you mean"),
            std::string::npos);
}

// Edit a comment box "in Neovim": the editor here is a shell script that
// writes the file and exits, which is what a save and :q does.
IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ExternalEditorWritesBack) {
  WriteConfig(R"([options]
editor = ["/bin/sh", "-c", "printf 'edited in nvim' > \"$1\"", "sh", "{file}"]
)");
  ReloadConfig();
  NavigateTo("/form");
  FocusElement("comment");
  EXPECT_EQ(mode(), ffi::Mode::Insert);
  EXPECT_EQ(controller()->RunCommandLine("edit"), "");
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(),
                           "document.getElementById('comment').value")
               .ExtractString() == "edited in nvim";
  }));
  // The page saw an ordinary input event, so frameworks update.
  EXPECT_NE(PageLog().find("input:insertReplacementText"), std::string::npos);

  // Password fields never leave, even with !.
  FocusElement("pw");
  RunAndWait("edit!");
  EXPECT_EQ(StatusMessage(), u"Password fields never leave the browser");
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, RefusedEditStopsPreviousSession) {
  WriteConfig(R"([options]
editor = ["/usr/bin/true", "{file}"]
)");
  ReloadConfig();
  NavigateTo("/form");
  FocusElement("comment");
  RunAndWait("edit");
  ASSERT_TRUE(base::test::RunUntil([&] {
    auto* editor = controller()->field_editor_for_testing();
    return editor && !editor->path().empty();
  }));
  const base::FilePath old_file =
      controller()->field_editor_for_testing()->path();
  FocusElement("pw");
  RunAndWait("edit!");
  EXPECT_EQ(StatusMessage(), u"Password fields never leave the browser");
  EXPECT_EQ(controller()->field_editor_for_testing(), nullptr);
  // A refused replacement must leave the old file available for recovery.
  base::ScopedAllowBlockingForTesting allow;
  EXPECT_TRUE(base::PathExists(old_file));
  EXPECT_TRUE(base::DeletePathRecursively(old_file.DirName()));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, PageColourNavigationAndCache) {
  NavigateTo("/form");
  PageColorSampler sampler(base::BindRepeating([](std::optional<SkColor>) {}));
  sampler.Watch(contents());
  SkBitmap black;
  black.allocN32Pixels(2, 2);
  black.eraseColor(SK_ColorBLACK);
  content::CopyFromSurfaceResult dark{viz::CopyOutputBitmapWithMetadata(black)};
  PageColorSamplerTestPeer::Begin(sampler, contents()).Run(dark);
  EXPECT_EQ(sampler.color(), SK_ColorBLACK);

  auto stale = PageColorSamplerTestPeer::Begin(sampler, contents());
  sampler.Watch(nullptr);
  sampler.Watch(contents());
  EXPECT_EQ(sampler.color(), SK_ColorBLACK);
  SkBitmap empty;
  empty.allocN32Pixels(2, 2);
  empty.eraseColor(SK_ColorTRANSPARENT);
  content::CopyFromSurfaceResult neutral{viz::CopyOutputBitmapWithMetadata(empty)};
  std::move(stale).Run(neutral);
  EXPECT_EQ(sampler.color(), SK_ColorBLACK);

  auto previous_page = PageColorSamplerTestPeer::Begin(sampler, contents());
  NavigateTo("/doc");
  PageColorSamplerTestPeer::StopTimer(sampler);
  // Navigation clears the old document's result before its new sample arrives.
  EXPECT_FALSE(sampler.color());
  std::move(previous_page).Run(dark);
  EXPECT_FALSE(sampler.color());
  PageColorSamplerTestPeer::Begin(sampler, contents()).Run(dark);
  EXPECT_EQ(sampler.color(), SK_ColorBLACK);
  PageColorSamplerTestPeer::Begin(sampler, contents()).Run(neutral);
  EXPECT_FALSE(sampler.color());
  sampler.Watch(nullptr);
  sampler.Watch(contents());
  EXPECT_FALSE(sampler.color());  // A cached neutral result is retained too.
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, PageColourBucketsAndContrast) {
  SkBitmap bitmap;
  bitmap.allocN32Pixels(12, 12);
  bitmap.eraseColor(SK_ColorBLACK);
  EXPECT_EQ(PageColorSampler::DominantColor(bitmap), SK_ColorBLACK);
  bitmap.eraseColor(SK_ColorWHITE);
  EXPECT_EQ(PageColorSampler::DominantColor(bitmap), SK_ColorWHITE);
  bitmap.eraseColor(SK_ColorTRANSPARENT);
  EXPECT_FALSE(PageColorSampler::DominantColor(bitmap));
  const std::array<SkColor, 4> colours = {SK_ColorRED, SK_ColorGREEN,
                            SK_ColorBLUE, SK_ColorWHITE};
  for (int y = 0; y < 12; ++y) {
    for (int x = 0; x < 12; ++x) {
      *bitmap.getAddr32(x, y) = colours.at(x / 3);
    }
  }
  EXPECT_FALSE(PageColorSampler::DominantColor(bitmap));
  for (int grey = 0; grey <= 255; ++grey) {
    const SkColor background = SkColorSetRGB(grey, grey, grey);
    const auto ink = style::InkOn(background);
    EXPECT_GE(color_utils::GetContrastRatio(ink.text, background), 4.5f);
    EXPECT_GE(color_utils::GetContrastRatio(ink.text_dim, background), 4.5f);
    EXPECT_GE(color_utils::GetContrastRatio(ink.icon, background), 4.5f);
  }
}

// -- Phase 4: outline, extraction, jumps, Visual mode ---------------------------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, OutlinePaletteJumps) {
  NavigateTo("/doc");
  PressLetters("gO");
  ASSERT_TRUE(palette()->IsVisible());
  EXPECT_EQ(palette_view()->model().kind, ffi::PaletteKind::Outline);
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return palette_view()->model().rows.size() == 5; }));
  const auto& rows = palette_view()->model().rows;
  EXPECT_EQ(rows[0].primary, u"Foo");
  EXPECT_EQ(rows[1].primary, u"Install");
  EXPECT_EQ(rows[1].indent, 1);
  EXPECT_EQ(rows[2].keys, u"code · sh");
  EXPECT_EQ(rows[3].primary, u"Usage");
  EXPECT_EQ(rows[4].keys, u"table");

  TypeInPalette(u"usage", ui::VKEY_RETURN);
  EXPECT_FALSE(palette()->IsVisible());
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(),
                           "Math.abs(document.getElementById('usage')"
                           ".getBoundingClientRect().top) < 30")
        .ExtractBool();
  }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ExtractMarkdownCopiesPage) {
  NavigateTo("/doc");
  RunAndWait("extract markdown");
  const std::u16string md = ReadClipboard();
  EXPECT_NE(md.find(u"# Foo docs\n"), std::u16string::npos) << md;
  EXPECT_NE(md.find(u"Read the [docs](https://docs.rs/foo) or call `foo()` now."),
            std::u16string::npos)
      << md;
  EXPECT_NE(md.find(u"```sh\ncargo add foo\n```"), std::u16string::npos) << md;
  EXPECT_NE(md.find(u"| Name | Value |\n| --- | --- |\n| a | 1 |"),
            std::u16string::npos)
      << md;
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, BracketsJumpBetweenHeadings) {
  NavigateTo("/doc");
  const KeySpec bracket{ui::DomKey::FromCharacter(']'),
                        ui::DomCode::BRACKET_RIGHT, ui::VKEY_OEM_6};
  // ]] twice: Install, then Usage (the h1 is already at the top). The
  // second press comes while the first jump is still scrolling.
  for (int i = 0; i < 2; ++i) {
    Press(bracket);
    Press(bracket);
  }
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(),
                           "Math.abs(document.getElementById('usage')"
                           ".getBoundingClientRect().top) < 30")
        .ExtractBool();
  }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, CodeBlockYankAndVisualSelect) {
  NavigateTo("/doc");
  // yc with one code block in view copies it straight away.
  base::RunLoop loop;
  controller()->set_page_work_done_callback_for_testing(loop.QuitClosure());
  PressLetters("yc");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return ReadClipboard() == u"cargo add foo"; }));
  controller()->set_page_work_done_callback_for_testing({});

  // v labels text blocks; choosing one selects it in Visual mode, y copies.
  std::vector<std::u16string> labels = ShowHints("v");
  ASSERT_GE(labels.size(), 3u);
  // Labels follow page order: h1, paragraph, ...
  PressLetters(base::UTF16ToUTF8(labels[1]));
  EXPECT_EQ(mode(), ffi::Mode::Visual);
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(), "String(getSelection()).length > 0")
        .ExtractBool();
  }));
  PressLetter('y');
  ASSERT_TRUE(base::test::RunUntil([&] {
    return ReadClipboard().starts_with(u"Read the docs or call");
  }));
  EXPECT_EQ(mode(), ffi::Mode::Normal);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, HistoryPaletteOpensVisitedPage) {
  NavigateTo("/doc");
  NavigateTo("/page");
  PressLetters("gh");
  ASSERT_TRUE(palette()->IsVisible());
  EXPECT_EQ(palette_view()->model().kind, ffi::PaletteKind::History);
  ASSERT_TRUE(base::test::RunUntil([&] {
    for (const auto& row : palette_view()->model().rows) {
      if (row.primary == u"Foo docs") {
        return true;
      }
    }
    return false;
  }));
  const GURL doc = embedded_test_server()->GetURL("/doc");
  content::TestNavigationObserver navigation(contents(), 1);
  TypeInPalette(u"foo docs", ui::VKEY_RETURN);
  navigation.Wait();
  EXPECT_EQ(contents()->GetLastCommittedURL(), doc);
}


// -- The rest of the plan: iframes, marks, edit key, projects, extensions ------

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, HintsReachIntoIframes) {
  NavigateTo("/frames");
  // Wait for both frames to load.
  ASSERT_TRUE(base::test::RunUntil([&] {
    for (size_t i = 0; i < 2; ++i) {
      content::RenderFrameHost* f = content::ChildFrameAt(contents(), i);
      if (!f || content::EvalJs(f, "document.readyState").ExtractString() !=
                    "complete") {
        return false;
      }
    }
    return true;
  }));
  EXPECT_TRUE(content::ChildFrameAt(contents(), 1)->IsCrossProcessSubframe());
  std::vector<std::u16string> labels = ShowHints("f");
  // Page order: the page's link, the same-origin frame's, the cross-site
  // (out-of-process) frame's.
  ASSERT_EQ(labels.size(), 3u);
  PressLetters(base::UTF16ToUTF8(labels[2]));
  ASSERT_TRUE(base::test::RunUntil([&] {
    content::RenderFrameHost* f = content::ChildFrameAt(contents(), 1);
    return f && f->GetLastCommittedURL().path() == "/two";
  }));
  // The page itself did not navigate.
  EXPECT_EQ(contents()->GetLastCommittedURL().path(), "/frames");

  labels = ShowHints("f");
  // /two uses kPageHtml: its input and contenteditable are both hint
  // targets, alongside the main link and the same-origin frame's link.
  ASSERT_EQ(labels.size(), 4u);
  PressLetters(base::UTF16ToUTF8(labels[1]));
  ASSERT_TRUE(base::test::RunUntil([&] {
    content::RenderFrameHost* f = content::ChildFrameAt(contents(), 0);
    return f && f->GetLastCommittedURL().path() == "/inner";
  }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, MarksReturnToAPosition) {
  NavigateTo("/doc");
  ASSERT_TRUE(content::ExecJs(contents(), "window.scrollTo(0, 800)"));
  PressLetters("ma");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return StatusMessage() == u"Mark a set"; }));
  PressLetters("gg");
  ASSERT_TRUE(base::test::RunUntil([&] { return ScrollY() == 0; }));
  Press({ui::DomKey::FromCharacter('\''), ui::DomCode::QUOTE, ui::VKEY_OEM_7});
  PressLetter('a');
  ASSERT_TRUE(base::test::RunUntil([&] { return ScrollY() == 800; }));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, EditKeyInsideAField) {
  WriteConfig(R"([options]
editor = ["/bin/sh", "-c", "printf 'from the edit key' > \"$1\"", "sh", "{file}"]
)");
  ReloadConfig();
  NavigateTo("/form");
  FocusElement("comment");
  // Ctrl+Shift+E while typing in the field.
  Press(Letter('E'), /*shift=*/true, /*ctrl=*/true);
  ASSERT_TRUE(base::test::RunUntil([&] {
    return content::EvalJs(contents(),
                           "document.getElementById('comment').value")
               .ExtractString() == "from the edit key";
  }));
  EXPECT_EQ(mode(), ffi::Mode::Insert);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, BrowserctlWorkspaceHere) {
  EXPECT_EQ(controller()->RunCommandLine("workspace project /tmp/modal-proj"),
            "");
  RunAndWait("workspace save proj");
  const size_t windows = GlobalBrowserCollection::GetInstance()->GetSize();
  const std::string reply = Browserctl(
      R"({"cmd":"workspace","action":"here","dir":"/tmp/modal-proj/src"})");
  EXPECT_EQ(reply, "{\"v\":1,\"ok\":true,\"result\":\"proj\"}\n");
  ASSERT_TRUE(base::test::RunUntil([&] {
    return GlobalBrowserCollection::GetInstance()->GetSize() == windows + 1;
  }));
  EXPECT_NE(Browserctl(
                R"({"cmd":"workspace","action":"here","dir":"/elsewhere"})")
                .find("no workspace has a project folder"),
            std::string::npos);
}

// An MV3 extension's content script still sees the keys the modal layer
// leaves to the page, and not the ones it uses; in Passthrough it sees all.
IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, ExtensionContentScriptCoexists) {
  // Covers the temporary directory's creation and its deletion at the end.
  base::ScopedAllowBlockingForTesting allow;
  base::ScopedTempDir dir;
  {
    ASSERT_TRUE(dir.CreateUniqueTempDir());
    ASSERT_TRUE(base::WriteFile(dir.GetPath().Append("manifest.json"), R"({
      "manifest_version": 3, "name": "key logger", "version": "1",
      "content_scripts": [{"matches": ["<all_urls>"], "js": ["cs.js"],
                           "run_at": "document_start"}]})"));
    ASSERT_TRUE(base::WriteFile(dir.GetPath().Append("cs.js"), R"(
      document.documentElement.dataset.ext = '';
      document.addEventListener('keydown', e => {
        document.documentElement.dataset.ext += e.key;
      }, true);)"));
  }
  extensions::ChromeTestExtensionLoader loader(browser()->GetProfile());
  scoped_refptr<const extensions::Extension> extension =
      loader.LoadExtension(dir.GetPath());
  ASSERT_TRUE(extension);
  NavigateTo("/page");
  auto seen = [&] {
    return content::EvalJs(contents(),
                           "document.documentElement.dataset.ext ?? 'none'")
        .ExtractString();
  };
  ASSERT_TRUE(base::test::RunUntil([&] { return seen() == ""; }));
  PressLetter('z');  // unbound: the page (and the extension) get it
  PressLetter('j');  // ours: scrolls, nobody else sees it
  ASSERT_TRUE(base::test::RunUntil([&] { return seen() == "z"; }));
  PressLetter('v', /*ctrl=*/true);  // Passthrough
  PressLetter('j');
  ASSERT_TRUE(base::test::RunUntil([&] { return seen() == "zj"; }));
}


IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest, NewProfilesReopenTheirSession) {
  PrefService* prefs = browser()->GetProfile()->GetPrefs();
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return prefs->HasPrefPath(prefs::kRestoreOnStartup); }));
  EXPECT_EQ(prefs->GetInteger(prefs::kRestoreOnStartup),
            SessionStartupPref::kPrefValueLast);
  // A choice made in Settings is never overwritten.
  prefs->SetInteger(prefs::kRestoreOnStartup,
                    SessionStartupPref::kPrefValueNewTab);
  ReloadConfig();
  EXPECT_EQ(prefs->GetInteger(prefs::kRestoreOnStartup),
            SessionStartupPref::kPrefValueNewTab);
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       SecureSiteControlsAndPermissionAnchors) {
  net::EmbeddedTestServer https(net::EmbeddedTestServer::TYPE_HTTPS);
  https.SetSSLConfig(net::EmbeddedTestServer::CERT_TEST_NAMES);
  https.RegisterRequestHandler(base::BindRepeating(&ServePage));
  ASSERT_TRUE(https.Start());
  ASSERT_TRUE(
      ui_test_utils::NavigateToURL(browser(), https.GetURL("a.test", "/page")));
  auto security = security_state::GetVisibleSecurityState(contents());
  ASSERT_TRUE(security);
  ASSERT_EQ(security_state::GetSecurityLevel(*security),
            security_state::SECURE);
  auto* controls = controller()->safety_controls_for_testing();
  ASSERT_TRUE(controls);
  auto* button = controls->site_button_for_testing();
  EXPECT_EQ(button->GetFocusBehavior(), views::View::FocusBehavior::ALWAYS);
  for (const char* layout : {"set tabs=top", "set tabs=side", "hide-tabs on"}) {
    ASSERT_EQ(controller()->RunCommandLine(layout), "");
    ASSERT_TRUE(base::test::RunUntil(
        [&] { return button->IsDrawn() && button->width() > 0; }));
    auto anchor =
        bubble_anchor_util::GetPermissionPromptBubbleAnchorConfiguration(
            contents());
    EXPECT_EQ(anchor.anchor.GetIfView(), button);
    // Exercise the button's keyboard handler, rather than clicking the
    // address field's old warning-only hit target.
    ui::KeyEvent press(ui::EventType::kKeyPressed, ui::VKEY_SPACE, ui::EF_NONE);
    ui::KeyEvent release(ui::EventType::kKeyReleased, ui::VKEY_SPACE,
                         ui::EF_NONE);
    button->OnKeyEvent(&press);
    button->OnKeyEvent(&release);
    ASSERT_TRUE(base::test::RunUntil([&] {
      return PageInfoBubbleViewBase::GetPageInfoBubbleForTesting(contents()) !=
             nullptr;
    }));
    auto* bubble =
        PageInfoBubbleViewBase::GetPageInfoBubbleForTesting(contents());
    EXPECT_EQ(bubble->GetAnchorView(), button);
    bubble->GetWidget()->CloseNow();

    // Headless Chromium intentionally denies queued permission requests.
    // Exercise its real prompt view with a synthetic delegate instead;
    // no production permission check or OS permission is bypassed.
    TestPermissionBubbleViewDelegate delegate;
    std::vector<std::unique_ptr<permissions::PermissionRequest>> requests;
    requests.push_back(std::make_unique<permissions::MockPermissionRequest>(
        contents()->GetLastCommittedURL(), permissions::RequestType::kMicStream,
        permissions::PermissionRequestGestureType::GESTURE));
    delegate.set_requests(std::move(requests));
    auto prompt = CreatePermissionPromptBubbleView(
        contents(), delegate.GetWeakPtr(), PermissionPromptStyle::kBubbleOnly);
    ASSERT_TRUE(prompt);
    prompt->Show();
    EXPECT_TRUE(prompt->GetWidget()->IsVisible());
    EXPECT_EQ(prompt->GetAnchorView(), button);
    prompt->GetWidget()->CloseNow();
  }
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       CaptureControlsSurviveCompactAndHiddenTabs) {
  auto* controls = controller()->safety_controls_for_testing();
  ASSERT_TRUE(controls);
  EXPECT_FALSE(controls->capture_button_for_testing()->GetVisible());
  auto* first = contents();
  ASSERT_TRUE(ui_test_utils::NavigateToURLWithDisposition(
      browser(), embedded_test_server()->GetURL("b.test", "/form"),
      WindowOpenDisposition::NEW_BACKGROUND_TAB,
      ui_test_utils::BROWSER_TEST_WAIT_FOR_LOAD_STOP));
  auto* second = browser()->tab_strip_model()->GetWebContentsAt(1);
  auto indicator = MediaCaptureDevicesDispatcher::GetInstance()
                       ->GetMediaStreamCaptureIndicator();
  blink::mojom::StreamDevices audio_devices;
  audio_devices.audio_device = blink::MediaStreamDevice(
      blink::mojom::MediaStreamType::DEVICE_AUDIO_CAPTURE, "test-mic",
      "Test microphone");
  auto audio = indicator->RegisterMediaStream(first, audio_devices);
  audio->OnStarted(base::BindLambdaForTesting([&] { audio.reset(); }), {}, "",
                   {}, {});
  blink::mojom::StreamDevices video_devices;
  video_devices.video_device = blink::MediaStreamDevice(
      blink::mojom::MediaStreamType::DEVICE_VIDEO_CAPTURE, "test-camera",
      "Test camera");
  auto video = indicator->RegisterMediaStream(second, video_devices);
  video->OnStarted(base::BindLambdaForTesting([&] { video.reset(); }), {}, "",
                   {}, {});
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return controls->capture_button_for_testing()->GetVisible(); }));
  EXPECT_EQ(controls->capture_button_for_testing()->GetFocusBehavior(),
            views::View::FocusBehavior::ALWAYS);
  EXPECT_EQ(controller()->RunCommandLine("pin on"), "");
  for (const char* layout : {"set tabs=top", "set tabs=side", "sidebar off"}) {
    ASSERT_EQ(controller()->RunCommandLine(layout), "");
    auto* bar = controller()->tab_bar_host_for_testing()->bar();
    ASSERT_TRUE(
        base::test::RunUntil([&] { return !bar->tabs_for_testing().empty(); }));
    auto* pinned = bar->tabs_for_testing()[0].get();
    ASSERT_TRUE(pinned->data().pinned);
    ASSERT_TRUE(base::test::RunUntil([&] {
      return pinned->data().alert == tabs::TabAlert::kAudioRecording;
    }));
    EXPECT_FALSE(pinned->AlertBoundsForTesting().IsEmpty());
    ui::AXNodeData accessible;
    pinned->GetViewAccessibility().GetAccessibleNodeData(&accessible);
    EXPECT_NE(accessible.GetString16Attribute(ax::mojom::StringAttribute::kName)
                  .find(tabs::TabAlertController::GetTabAlertStateText(
                      tabs::TabAlert::kAudioRecording)),
              std::u16string::npos);
  }
  ASSERT_EQ(controller()->RunCommandLine("hide-tabs on"), "");
  EXPECT_TRUE(controls->capture_button_for_testing()->IsDrawn());
  auto* menu = controls->BuildCaptureMenuForTesting();
  ASSERT_EQ(menu->GetItemCount(), 5u);  // two tabs, with a separator
  EXPECT_NE(menu->GetLabelAt(0).find(u"Microphone"), std::u16string::npos);
  EXPECT_NE(menu->GetLabelAt(3).find(u"Camera"), std::u16string::npos);
  // Stop the first stream; a stale menu still addresses the second tab by
  // its handle, rather than its changing list position.
  controls->ExecuteCommand(1, 0);
  EXPECT_FALSE(audio);
  EXPECT_TRUE(video);
  EXPECT_FALSE(controls->IsCommandIdEnabled(1));
  controls->ExecuteCommand(3, 0);
  EXPECT_FALSE(video);
  EXPECT_FALSE(controls->capture_button_for_testing()->GetVisible());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       SharingControlStopsScreenCapture) {
  auto* controls = controller()->safety_controls_for_testing();
  ASSERT_TRUE(controls);
  auto indicator = MediaCaptureDevicesDispatcher::GetInstance()
                       ->GetMediaStreamCaptureIndicator();
  blink::mojom::StreamDevices devices;
  devices.video_device = blink::MediaStreamDevice(
      blink::mojom::MediaStreamType::GUM_TAB_VIDEO_CAPTURE, "test-tab",
      "Test tab");
  auto stream = indicator->RegisterMediaStream(contents(), devices);
  stream->OnStarted(base::BindLambdaForTesting([&] { stream.reset(); }), {}, "",
                    {}, {});
  ASSERT_EQ(controller()->RunCommandLine("hide-tabs on"), "");
  ASSERT_TRUE(base::test::RunUntil(
      [&] { return controls->capture_button_for_testing()->IsDrawn(); }));
  auto* menu = controls->BuildCaptureMenuForTesting();
  ASSERT_EQ(menu->GetItemCount(), 2u);
  EXPECT_NE(menu->GetLabelAt(0).find(u"sharing"), std::u16string::npos);
  NavigateTo("/doc");
  // A stale menu must not act on a replacement document in the same tab.
  EXPECT_FALSE(controls->IsCommandIdEnabled(1));
  controls->BuildCaptureMenuForTesting();
  controls->ExecuteCommand(1, 0);
  EXPECT_FALSE(stream);
  EXPECT_FALSE(controls->capture_button_for_testing()->GetVisible());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       PrivateWindowsKeepAnExplicitLabel) {
  EXPECT_FALSE(controller()
                   ->safety_controls_for_testing()
                   ->private_badge_for_testing()
                   ->GetVisible());
  auto* private_window = CreateIncognitoBrowser();
  auto* private_controller = ModalBrowserController::From(private_window);
  ASSERT_TRUE(ui_test_utils::NavigateToURL(
      private_window, embedded_test_server()->GetURL("b.test", "/page")));
  ASSERT_TRUE(private_controller);
  auto* controls = private_controller->safety_controls_for_testing();
  ASSERT_TRUE(controls);
  for (const char* layout : {"set tabs=top", "set tabs=side", "hide-tabs on"}) {
    ASSERT_EQ(private_controller->RunCommandLine(layout), "");
    EXPECT_TRUE(controls->private_badge_for_testing()->IsDrawn());
    EXPECT_TRUE(controls->site_button_for_testing()->IsDrawn());
    ui::AXNodeData accessible;
    controls->private_badge_for_testing()
        ->GetViewAccessibility()
        .GetAccessibleNodeData(&accessible);
    EXPECT_EQ(
        accessible.GetString16Attribute(ax::mojom::StringAttribute::kName),
        u"Private browsing");
  }
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       PageTintRespectsAccessibleThemes) {
  ui::ColorProviderKey key;
  EXPECT_TRUE(style::PageColorsAllowed(key));
  key.contrast_mode = ui::ColorProviderKey::ContrastMode::kHigh;
  EXPECT_FALSE(style::PageColorsAllowed(key));
  key.contrast_mode = ui::ColorProviderKey::ContrastMode::kNormal;
  for (auto forced : {ui::ColorProviderKey::ForcedColors::kSystem,
                      ui::ColorProviderKey::ForcedColors::kDusk,
                      ui::ColorProviderKey::ForcedColors::kWhite}) {
    key.forced_colors = forced;
    EXPECT_FALSE(style::PageColorsAllowed(key));
  }
  auto* view = BrowserView::GetBrowserViewForBrowser(browser());
  auto* theme = view->GetNativeTheme();
  const auto previous_contrast = theme->preferred_contrast();
  const auto previous_forced = theme->forced_colors();
  base::ScopedClosureRunner restore(base::BindLambdaForTesting([&] {
    theme->set_preferred_contrast(previous_contrast);
    theme->set_forced_colors(previous_forced);
    theme->NotifyOnNativeThemeUpdated();
  }));
  theme->set_preferred_contrast(ui::NativeTheme::PreferredContrast::kMore);
  theme->set_forced_colors(ui::ColorProviderKey::ForcedColors::kWhite);
  theme->NotifyOnNativeThemeUpdated();
  EXPECT_FALSE(style::PageSurface(view, SK_ColorRED));
  auto* bar = controller()->tab_bar_host_for_testing()->bar();
  bar->SetActiveColor(SK_ColorRED);
  EXPECT_EQ(bar->ActiveFill(),
            bar->GetColorProvider()->GetColor(kColorToolbar));
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       WorkspaceHereSkipsDisabledWindows) {
  ASSERT_TRUE(base::test::RunUntil([&] {
    return Browserctl(R"({"cmd":"ping"})").find("protocol") !=
           std::string::npos;
  }));
  EXPECT_EQ(controller()->RunCommandLine("workspace project /tmp/modal-proj"),
            "");
  RunAndWait("workspace save proj");
  auto* disabled = CreateBrowser(browser()->GetProfile());
  ASSERT_TRUE(
      ui_test_utils::NavigateToURL(disabled, GURL(chrome::kChromeUINewTabURL)));
  auto* disabled_controller = ModalBrowserController::From(disabled);
  ASSERT_TRUE(disabled_controller);
  {
    base::ScopedAllowBlockingForTesting allow;
    ASSERT_TRUE(
        base::WriteFile(ConfigPath(), "[options]\nbrowserctl = false\n"));
  }
  // Deliberately reload only this window; the first still owns the server.
  RunAndWaitOn(disabled_controller, "config-reload");
  ASSERT_FALSE(disabled_controller->browserctl_enabled_for_testing());
  ASSERT_TRUE(controller()->browserctl_enabled_for_testing());
  ASSERT_EQ(GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser(),
            disabled);
  const size_t before = GlobalBrowserCollection::GetInstance()->GetSize();
  const auto reply = Browserctl(
      R"({"cmd":"workspace","action":"here","dir":"/tmp/modal-proj/src"})");
  EXPECT_EQ(reply, "{\"v\":1,\"ok\":true,\"result\":\"proj\"}\n");
  ASSERT_TRUE(base::test::RunUntil([&] {
    return GlobalBrowserCollection::GetInstance()->GetSize() == before + 1;
  }));
  EXPECT_TRUE(disabled_controller->workspace_for_testing().empty());
}

IN_PROC_BROWSER_TEST_F(ModalBrowserBrowserTest,
                       ContentFullscreenRestoresToolbarWithoutCrossingWidgets) {
  auto* view = BrowserView::GetBrowserViewForBrowser(browser());
  ASSERT_TRUE(view);
  EXPECT_EQ(true, content::EvalJs(contents(), R"JS((async()=>{
    await document.documentElement.requestFullscreen();
    return !!document.fullscreenElement;
  })())JS"));
  EXPECT_EQ(true, content::EvalJs(contents(), R"JS((async()=>{
    await document.exitFullscreen();
    return !document.fullscreenElement;
  })())JS"));
  ASSERT_TRUE(
      base::test::RunUntil([&] { return !view->GetWidget()->IsFullscreen(); }));
  view->GetWidget()->LayoutRootViewIfNecessary();
  ASSERT_TRUE(base::test::RunUntil([&] {
    return view->toolbar()->parent() && view->Contains(view->toolbar());
  }));
  EXPECT_TRUE(contents()->GetPrimaryMainFrame()->IsRenderFrameLive());
}

}  // namespace modal_browser
