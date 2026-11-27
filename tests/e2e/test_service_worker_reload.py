"""Synchronous loads made by pages and workers under a service worker."""

import unittest

from merlin_e2e import Merlin, MerlinTestCase, PageServer


class WorkerServer(PageServer):
    def respond(self, host, path):
        headers = {"Cache-Control": "no-store"}
        if path.split("?")[0] == "/sync/page":
            return 200, "text/html", b"""
                <!doctype html><title>Worker reload</title>
                <a href="/sync/page?link" id="next">Next page</a>
                <script>
                  function runWorker(kind, url = '/sync/import.js') {
                    return new Promise((resolve, reject) => {
                      const shared = kind === 'shared';
                      const worker = shared ? new SharedWorker('worker.js') : new Worker('worker.js');
                      const port = shared ? worker.port : worker;
                      worker.onerror = () => reject(new Error('Worker failed'));
                      port.onmessage = event => {
                        if (shared) port.close(); else worker.terminate();
                        resolve(event.data);
                      };
                      port.postMessage({kind, url});
                    });
                  }
                  const initial = runWorker('dedicated');
                </script>
            """, headers
        if path == "/sync/sw.js":
            return 200, "text/javascript", b"""
                self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
                self.addEventListener('fetch', event => {
                  const path = new URL(event.request.url).pathname;
                  if (path === '/sync/data') {
                    event.respondWith(new Response('service worker'));
                  } else if (path === '/sync/import.js' || path === '/sync/ads/custom_ads.js') {
                    event.respondWith(new Response("self.source = 'service worker';", {
                      headers: {'Content-Type': 'text/javascript'}
                    }));
                  }
                });
            """, headers
        if path == "/sync/worker.js":
            return 200, "text/javascript", b"""
                function listen(port) {
                  port.onmessage = ({data}) => {
                    if (data.kind === 'nested') {
                      const child = new Worker('worker.js');
                      child.onmessage = event => { port.postMessage(event.data); child.terminate(); };
                      child.postMessage({url: data.url});
                      return;
                    }
                    try {
                      importScripts(data.url);
                      port.postMessage(self.source);
                    } catch (error) {
                      port.postMessage(error.name);
                    }
                  };
                }
                if ('onconnect' in self) self.onconnect = event => listen(event.ports[0]);
                else listen(self);
            """, headers
        if path in ("/sync/import.js", "/sync/ads/custom_ads.js"):
            return 200, "text/javascript", b"self.source = 'network';", headers
        return super().respond(host, path)


class ServiceWorkerReloadTest(MerlinTestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = WorkerServer()
        try:
            cls.browser = Merlin(cls.server)
        except BaseException:
            cls.server.close()
            raise

    def tab(self):
        snapshot = self.browser.snapshot()
        return next(tab for tab in snapshot['tabs'] if tab['id'] == snapshot['activeTabId'])

    def test_controlled_reload_and_link_navigation(self):
        self.browser.open('/sync/page')
        self.assertEqual(self.browser.eval('initial'), 'network')
        self.assertTrue(self.browser.eval("""(async () => {
          const claimed = new Promise(resolve => {
            navigator.serviceWorker.addEventListener('controllerchange', resolve, {once: true});
          });
          await navigator.serviceWorker.register('sw.js');
          await claimed;
          return !!navigator.serviceWorker.controller;
        })()"""))

        def reload(command, source):
            self.server.clear()
            self.assertTrue(command().get('ok'))
            self.wait(lambda: self.server.requested('/sync/page') and not self.tab()['loading'],
                      'the new document to finish loading')
            self.assertFalse(self.tab()['crashed'])
            self.assertEqual(self.browser.eval('initial'), source)

        tab = self.tab()['id']
        reload(lambda: self.browser.shell_call('navigation.reload', {'tabId': tab}), 'service worker')
        self.assertTrue(self.browser.eval('!!navigator.serviceWorker.controller'))

        self.assertEqual(self.browser.eval("""(() => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '/sync/data', false);
          xhr.send();
          return xhr.responseText;
        })()"""), 'service worker')

        # An ad response produced by the service worker must still be blocked.
        for kind in ('dedicated', 'shared', 'nested'):
            with self.subTest(worker=kind):
                self.assertEqual(self.browser.eval(f'runWorker({kind!r})'), 'service worker')
                self.assertEqual(self.browser.eval(f'runWorker({kind!r}, "/sync/ads/custom_ads.js")'),
                                 'NetworkError')

        self.browser.eval("document.querySelector('#next').click()")
        self.wait(lambda: self.browser.active_tab()['url'].endswith('?link'), 'the link destination')
        self.wait(lambda: self.browser.eval('location.search') == '?link', 'the linked document')
        self.assertEqual(self.browser.eval('initial'), 'service worker')
        self.assertFalse(self.tab()['crashed'])
        reload(lambda: self.browser.command('reload!'), 'network')
