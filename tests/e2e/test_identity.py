"""Merlin's identity on the pages Chromium still draws.

Ported from MerlinIdentityBrowserTest: Chromium's own pages that Settings
opens, error pages and the version page say Merlin, never Chrome or Chromium
(except in names such as the Chrome Web Store).
"""

from __future__ import annotations

import unittest

from merlin_e2e import MerlinTestCase, wait_until

# Visible text and accessible names mentioning Chrome or Chromium, minus the
# proper names Merlin keeps and any file paths.
CHROME_MENTIONS = r"""(() => {
  const text = root => Array.from(root.childNodes || []).map(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      return parent && parent.getClientRects().length ? node.textContent : '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE ||
        /^(SCRIPT|STYLE|TEMPLATE)$/.test(node.tagName) ||
        getComputedStyle(node).visibility === 'hidden') return '';
    const accessible = node.getClientRects().length ?
        [node.getAttribute('aria-label'), node.getAttribute('title')].filter(Boolean).join(' ') : '';
    return accessible + ' ' + text(node.shadowRoot || node);
  }).join(' ');
  return (text(document.body).replaceAll('Chrome Root Store', '').replaceAll('Chrome Root Program', '')
      .replaceAll('Chrome Web Store', '').replace(/\/(?:Users|var|private|tmp|Applications)\/[^\s‎]+/g, '')
      .match(/.{0,60}\b(?:Chrome|Chromium)\b.{0,60}/g) || []).join(' | ');
})()"""

PAGES = [
    "chrome://password-manager/passwords",
    "chrome://password-manager/settings",
    "chrome://settings/content",
    "chrome://settings/addresses",
    "chrome://settings/payments",
    "chrome://settings/security",
    "chrome://extensions/",
    "chrome://certificate-manager/",
]


class IdentityTest(MerlinTestCase):
    # Chromium's own pages, and error pages, have addresses browserctl and
    # DevTools report differently, so these tests keep the tab's DevTools
    # session instead of looking it up by address.
    def setUp(self) -> None:
        super().setUp()
        self.session = self.browser.active_session()

    def eval(self, expression: str):
        return self.browser.eval(expression, self.session)

    def navigate(self, url: str) -> None:
        self.browser.cdp.call("Page.navigate", {"url": url}, self.session)
        # Some pages redirect (chrome://settings/addresses, for one).
        wait_until(lambda: self.eval("document.readyState") == "complete" and
                   self.eval("location.protocol") == "chrome:",
                   timeout=15, message=f"{url} to load")
        # Polymer pages fill in after load; give them two frames.
        self.eval("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")

    def test_chromium_pages_never_say_chrome(self) -> None:
        for url in PAGES:
            with self.subTest(url=url):
                self.navigate(url)
                self.assertEqual(self.eval(CHROME_MENTIONS), "")

    def test_version_page_names_merlin(self) -> None:
        self.navigate("chrome://version/")
        self.assertIn("Merlin", self.eval("document.body.innerText"))
        # The user agent says Chrome on purpose, as every Chromium browser's
        # does, so sites keep working; the command line holds paths.
        self.eval("for (const id of ['useragent', 'command_line']) "
                  "document.getElementById(id)?.closest('tr')?.remove()")
        self.assertEqual(self.eval(CHROME_MENTIONS), "")

    def load_network_error(self) -> None:
        self.browser.cdp.call("Page.navigate", {"url": "http://127.0.0.1:1/"}, self.session)
        self.wait(lambda: self.eval("document.body.classList.contains('neterror')"),
                  "the network error page")

    def test_network_errors_never_say_chrome(self) -> None:
        self.load_network_error()
        self.assertEqual(self.eval(CHROME_MENTIONS), "")

    @unittest.expectedFailure
    def test_network_errors_are_restyled(self) -> None:
        # Regression: 5729e15 deleted RestyleMerlinPage with the Views UI, so
        # error pages and certificate warnings show Chromium's own styling
        # again. Remove expectedFailure once the React build restyles them.
        self.load_network_error()
        self.wait(lambda: self.eval("!!document.querySelector('#merlin-style')"),
                  "Merlin's styles on the error page", timeout=3)


if __name__ == "__main__":
    unittest.main()
