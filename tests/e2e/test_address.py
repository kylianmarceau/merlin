"""What the address field is told about a page: its address and its security.

The shell shows `displayUrl`, `displayHost` and `security` from the window
snapshot, which native code fills from Chromium's own URL formatting and
security state (merlin_urls.h). These tests read them through shell-call for
real pages and addresses, so they test that native code, not a copy of it.
"""

from __future__ import annotations

import time

from merlin_e2e import MerlinTestCase, TargetClosed, CdpError


class AddressTest(MerlinTestCase):
    def snapshot(self) -> dict:
        reply = self.browser.shell_call("window.snapshot")
        self.assertTrue(reply.get("ok"), reply)
        return reply["result"]

    def active(self) -> dict:
        snapshot = self.snapshot()
        return next(t for t in snapshot["tabs"] if t["id"] == snapshot["activeTabId"])

    def visit(self, url: str, expect_url: str | None = None) -> dict:
        """Opens `url` in the tab, waits until it has settled and returns its row."""
        self.browserctl_ok("open", url=url, where="current")
        wanted = expect_url or url
        return self.wait(lambda: (t := self.active())["url"] == wanted and not t["loading"] and
                         t.get("security") != "pending" and t, f"{wanted} to load", timeout=15)

    def browserctl_ok(self, cmd: str, **fields) -> dict:
        reply = self.browser.browserctl(cmd, **fields)
        self.assertTrue(reply.get("ok"), reply)
        return reply

    def shown(self, url: str, expect_url: str | None = None) -> tuple[str, str]:
        tab = self.visit(url, expect_url)
        return tab["displayUrl"], tab["displayHost"]

    def test_a_user_name_never_passes_for_the_site(self):
        port = self.server.port
        tab = self.visit(f"http://accounts.google.com@evil.test:{port}/login")
        self.assertEqual((tab["displayUrl"], tab["displayHost"]), (f"evil.test:{port}/login", f"evil.test:{port}"))
        self.assertTrue(self.server.requested("/login", host="evil.test"))
        # A password, and an "@" inside it, are dropped too.
        self.assertEqual(self.shown(f"http://user:pa%40ss@evil.test:{port}/a"),
                         (f"evil.test:{port}/a", f"evil.test:{port}"))

    def test_ports_and_the_trivial_parts_of_an_address(self):
        port = self.server.port
        # Not the default port: kept. "www." and http:// are dropped, as in Chromium.
        self.assertEqual(self.shown(f"http://www.site.test:{port}/a?b=1#c"),
                         (f"site.test:{port}/a?b=1#c", f"site.test:{port}"))
        self.assertEqual(self.shown(f"http://site.test:{port}/"), (f"site.test:{port}", f"site.test:{port}"))

    def test_a_lookalike_host_stays_in_punycode(self):
        port = self.server.port
        # Cyrillic "аррӏе", which reads as "apple": Chromium's spoof checks keep it in punycode.
        self.assertEqual(self.shown(f"http://xn--80ak6aa92e.test:{port}/"),
                         (f"xn--80ak6aa92e.test:{port}", f"xn--80ak6aa92e.test:{port}"))
        # An ordinary international name reads as written.
        self.assertEqual(self.shown(f"http://xn--mnchen-3ya.test:{port}/a"),
                         (f"münchen.test:{port}/a", f"münchen.test:{port}"))

    def test_right_to_left_hosts_keep_the_address_in_order(self):
        port = self.server.port
        # Hebrew "ישראל": the host comes first and the path after it, in the
        # order they are typed; the field shows them left to right.
        url, host = self.shown(f"http://xn--4dbrk0ce.test:{port}/path")
        self.assertEqual((url, host), (f"ישראל.test:{port}/path", f"ישראל.test:{port}"))

    def test_ipv6_and_long_hosts(self):
        # Nothing listens there: the error page keeps the address it failed on.
        self.assertEqual(self.shown("http://[::1]:1/x"), ("[::1]:1/x", "[::1]:1"))
        port = self.server.port
        long_host = ".".join(letter * 63 for letter in "abc") + ".test"
        self.assertEqual(self.shown(f"http://{long_host}:{port}/a"),
                         (f"{long_host}:{port}/a", f"{long_host}:{port}"))

    def test_security_comes_from_chromium_not_the_scheme(self):
        self.assertEqual(self.visit(self.server.url("/page"))["security"], "insecure")
        merlin = self.visit("chrome://version", "chrome://version/")
        self.assertEqual((merlin["security"], merlin["displayUrl"]), ("internal", "merlin://version"))

    def test_a_certificate_error_stays_dangerous_after_proceeding(self):
        url = self.server.https_url("/page")
        port = self.server.https_port
        warning = self.visit(url)
        self.assertEqual(warning["security"], "dangerous")
        self.assertFalse(self.server.requested("/page", host="expired.test"))
        # Proceed, as "Proceed to expired.test (unsafe)" does.
        def proceed():
            try:
                self.browser.eval("certificateErrorPageController.proceed()")
            except (TargetClosed, CdpError):
                pass  # the warning page went away as it proceeded
            return self.server.requested("/page", host="expired.test")
        self.wait(proceed, "the page behind the warning to load", timeout=15)
        tab = self.wait(lambda: (t := self.active())["url"] == url and not t["loading"] and t,
                        "the page to settle")
        # https:, its page shown, and still no lock.
        self.assertEqual((tab["security"], tab["displayUrl"], tab["displayHost"]),
                         ("dangerous", f"expired.test:{port}/page", f"expired.test:{port}"))
        # The site panel says the same, about the same host.
        self.assertTrue(self.browser.shell_call("site.info").get("ok"))
        prompt = self.wait(lambda: self.snapshot().get("prompt"), "the site panel")
        self.assertEqual((prompt["security"], prompt["origin"]), ("dangerous", f"expired.test:{port}"))
        time.sleep(0.6)  # prompts ignore answers for their first half second
        self.assertTrue(self.browser.shell_call("permissions.answer",
                                                {"promptId": prompt["id"], "actionId": "done"}).get("ok"))
        self.wait(lambda: not self.snapshot().get("prompt"), "the site panel to close")
