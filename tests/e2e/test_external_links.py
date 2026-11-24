"""A web redirect to an installed app prompts first and keeps Merlin running."""

import tempfile
import unittest
from pathlib import Path

from merlin_e2e import Merlin, PageServer, wait_until


class ExternalLinkServer(PageServer):
    def respond(self, host: str, path: str) -> tuple[int, str, bytes, dict]:
        if path == "/external-app-redirect":
            return 302, "text/plain", b"", {
                "Location": "webcal://localhost/merlin-fixture.ics",
            }
        return super().respond(host, path)


class ExternalLinksTest(unittest.TestCase):
    def test_redirect_to_external_app_prompts_without_crashing(self) -> None:
        server = ExternalLinkServer()
        self.addCleanup(server.close)
        with tempfile.TemporaryDirectory(prefix="merlin-external-prompt-") as directory:
            prompt_log = Path(directory) / "prompt"
            browser = Merlin(server, extra_env={
                "MERLIN_E2E_EXTERNAL_PROMPT_LOG": str(prompt_log),
            })
            try:
                browser.open("/page", "source.localhost")
                session = browser.active_session()
                point = browser.eval("""(() => {
                    const link = document.createElement('a');
                    link.textContent = 'Open calendar invite';
                    link.href = '/external-app-redirect';
                    document.body.prepend(link);
                    const rect = link.getBoundingClientRect();
                    return { x: rect.left + 3, y: rect.top + 3 };
                })()""", session)
                for kind, buttons in (("mousePressed", 1), ("mouseReleased", 0)):
                    browser.cdp.call("Input.dispatchMouseEvent", {
                        "type": kind, "button": "left", "buttons": buttons,
                        "clickCount": 1, **point,
                    }, session)

                wait_until(lambda: server.requested("/external-app-redirect"),
                           message="the redirect to reach the server")
                wait_until(prompt_log.is_file, message="the native external-app confirmation")
                self.assertTrue(browser.browserctl("ping")["ok"])
                self.assertEqual(browser.eval("location.pathname", session), "/page")
            finally:
                # Close the browser without accepting the prompt or opening Calendar.
                browser.close()


if __name__ == "__main__":
    unittest.main()
