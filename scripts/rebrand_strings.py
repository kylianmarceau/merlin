#!/usr/bin/env python3
# Copyright 2026 The modal_browser Authors
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.
"""Names the product Merlin in Chromium's desktop string files.

Patch 0007 is the output of this script, so after a Chromium update it is
regenerated instead of rebased by hand:

    python3 scripts/rebrand_strings.py --patch ~/chromium/src \\
        > patches/0007-merlin-strings.patch
    python3 scripts/rebrand_strings.py --apply ~/chromium/src
    python3 scripts/rebrand_strings.py --report ~/chromium/src

--patch starts from each file at the checkout's HEAD, applies the earlier
patches (0001-0006) that touch it, rebrands, and prints a unified diff.
--apply rebrands the files in the checkout in place (idempotent).
--report lists what is left that a user could read: "Chromium" kept on
purpose, and "Chrome" and "Google", which are not replaced by script.

Only text inside <message> elements changes, and never inside <ex>
examples (translator hints, not shown). Uses that name the project
rather than the product stay: "Chromium OS", "The Chromium Authors",
"Chromium project", "Chromium open source", chromium.org. Other locales
lose their translation for a changed message and show this English text.
"""

import os
import re
import subprocess
import sys
import tempfile

# Every desktop string file with a user-visible "Chromium". iOS, Android,
# ChromeOS (ash, os_settings) and policy templates are not built for Mac.
FILES = [
    "chrome/app/chromium_strings.grd",
    "chrome/app/settings_chromium_strings.grdp",
    "chrome/app/password_manager_ui_strings.grdp",
    "chrome/app/settings_strings.grdp",
    "chrome/app/generated_resources.grd",
    "components/components_chromium_strings.grd",
    "components/autofill_payments_strings.grdp",
    "components/autofill_strings.grdp",
    "components/management_strings.grdp",
    "components/new_or_sad_tab_strings.grdp",
    "components/omnibox_pedal_ui_strings.grdp",
    "components/omnibox_strings.grdp",
    "components/page_info_strings.grdp",
    "components/password_manager_strings.grdp",
    "components/privacy_sandbox_strings.grd",
    "components/reset_password_strings.grdp",
    "components/search_engine_choice_strings.grdp",
    "components/security_interstitials_strings.grdp",
    "components/ssl_errors_strings.grdp",
    "components/version_ui_strings.grdp",
    "extensions/strings/extensions_chromium_strings.grdp",
]

THIS_PATCH = "0007-merlin-strings.patch"

KEEP = re.compile(
    r"Chromium(?=\s*OS\b|OS\b|\s+Authors|\s+project|\s+Projects"
    r"|\s+open[- ]source|\s+contributors|\.org|_"
    r"|<ph name=\"END_LINK_CHROMIUM\")")

# Messages rewritten as a whole, by name: the legal lines on the About and
# version pages, where a word-for-word swap would misstate who made what.
# Chromium's copyright and licenses stay on merlin://credits.
# IDS_VERSION_UI_LICENSE is filled with three arguments and Chromium
# DCHECKs that each $n appears, so $1 (the Chromium project URL) stays in an
# empty, hidden link.
OVERRIDES = {
    "IDS_ABOUT_VERSION_COMPANY_NAME":
        "\n            Made possible by open-source software\n          ",
    "IDS_ABOUT_VERSION_COPYRIGHT":
        '\n            Copyright <ph name="YEAR">{0,date,y}<ex>2016</ex></ph>'
        " The Merlin Authors.\n          ",
    "IDS_VERSION_UI_LICENSE":
        '\n        Made possible by <ph name="BEGIN_LINK_OSS">&lt;a target="_blank"'
        ' href="$2" aria-description="$3"&gt;</ph>open-source software'
        '<ph name="END_LINK_OSS">&lt;/a&gt;</ph>.<ph name="HIDDEN_LINK">'
        '&lt;a href="$1" hidden&gt;&lt;/a&gt;</ph>\n      ',
}
# Product names in visible text that survive the Chromium swap (round 2
# step 8): the password manager, Safe Browsing and the extension store keep
# what they do and lose the Google and Chrome names. "Chrome's" in English
# text is always the browser itself. Applied in order, longest first.
PHRASES = [
    ("Google Password Manager", "Merlin Password Manager"),
    ("Chrome Password Manager", "Merlin Password Manager"),
    ("Google Safe Browsing", "Safe Browsing"),
    ("Chrome Web Store", "Web Store"),
    ("Chrome Desktop", "Merlin"),
    ("Chrome's", "Merlin's"),
    ("in Chrome", "in Merlin"),
    ("to Chrome", "to Merlin"),
    ("from Chrome", "from Merlin"),
]
MESSAGE = re.compile(r"(<message\b[^>]*>)(.*?)(</message>)", re.S)
EXAMPLE = re.compile(r"(<ex>.*?</ex>)", re.S)


def rebrand(text: str) -> tuple[str, int, int]:
    replaced = kept = 0

    def fix_run(run: str) -> str:
        nonlocal replaced, kept

        def one(m: re.Match) -> str:
            nonlocal replaced, kept
            if KEEP.match(run, m.start()):
                kept += 1
                return m.group(0)
            replaced += 1
            return "Merlin"

        run = re.sub(r"Chromium", one, run)
        for old, new in PHRASES:
            replaced += run.count(old)
            run = run.replace(old, new)
        return run

    def fix_body(body: str) -> str:
        # Odd pieces are <ex> examples; leave them alone.
        parts = EXAMPLE.split(body)
        return "".join(p if i % 2 else fix_run(p) for i, p in enumerate(parts))

    def fix_message(m: re.Match) -> str:
        nonlocal replaced
        name = re.search(r'name="([^"]+)"', m.group(1))
        name = name.group(1) if name else ""
        if name in OVERRIDES:
            body = OVERRIDES[name]
            replaced += body != m.group(2)
            return m.group(1) + body + m.group(3)
        return m.group(1) + fix_body(m.group(2)) + m.group(3)

    out = MESSAGE.sub(fix_message, text)
    return out, replaced, kept


# <if expr> names that are false in a Merlin Mac build; any other name
# (enable_* flags, toolkit_views, use_titlecase) counts as true.
FALSE_IN_BUILD = {
    "_google_chrome", "is_android", "is_ios", "is_chromeos", "chromeos_ash",
    "chromeos_lacros", "is_win", "is_linux", "is_fuchsia", "is_desktop_linux",
    "reven", "_is_chrome_for_testing_branded", "is_chrome_for_testing",
}


class _Names(dict):
    def __missing__(self, key):
        return key not in FALSE_IN_BUILD


def built_on_mac(expr: str) -> bool:
    names = _Names(is_macosx=True, is_posix=True, _chromium=True,
                   pp_ifdef=lambda _: True)
    try:
        return bool(eval(expr, {"__builtins__": {}}, names))
    except Exception:
        return True


def mac_elements(text: str, element: str = "message"):
    """Yields the starts of <element> tags a Merlin Mac build compiles,
    following <if>, <then> and <else>."""
    stack = []
    for tag in re.finditer(rf'<if expr="([^"]*)"\s*>|</if>|<else>|<{element}\b',
                           text):
        if tag.group(0) == "</if>":
            stack.pop()
        elif tag.group(0) == "<else>":
            stack[-1] = not stack[-1]
        elif tag.group(0).startswith("<if"):
            stack.append(built_on_mac(tag.group(1)))
        elif all(stack):
            yield tag.start()


def mac_messages(text: str):
    """Yields <message> matches that a Merlin Mac build compiles."""
    pos = 0
    for start in mac_elements(text):
        if start >= pos:
            m = MESSAGE.match(text, start)
            if m:
                pos = m.end()
                yield m


def visible_words(text: str, word: str) -> list[str]:
    """Message names whose shown text still contains `word`."""
    hits = []
    for m in mac_messages(text):
        body = EXAMPLE.sub("", m.group(2))
        body = re.sub(r"<ph\b[^>]*>|</ph>", "", body)
        if re.search(rf"\b{word}\b", body):
            name = re.search(r'name="([^"]+)"', m.group(1))
            hits.append(name.group(1) if name else "?")
    return hits


def base_text(src: str, path: str, patches_dir: str) -> str:
    """The file at HEAD with the earlier patches that touch it applied."""
    head = subprocess.run(["git", "-C", src, "show", f"HEAD:{path}"],
                          check=True, capture_output=True, text=True).stdout
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, path)
        os.makedirs(os.path.dirname(target))
        with open(target, "w", encoding="utf-8") as f:
            f.write(head)
        for name in sorted(os.listdir(patches_dir)):
            if not name.endswith(".patch") or name >= THIS_PATCH:
                continue
            patch = os.path.join(patches_dir, name)
            with open(patch, encoding="utf-8") as f:
                if f"+++ b/{path}\n" not in f.read():
                    continue
            subprocess.run(["git", "apply", f"--include={path}", patch],
                           cwd=tmp, check=True)
        with open(target, encoding="utf-8") as f:
            return f.read()


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("--patch", "--apply",
                                                  "--report"):
        print(__doc__)
        return 2
    mode, src = sys.argv[1], os.path.expanduser(sys.argv[2])
    patches_dir = os.path.join(os.path.dirname(__file__), "..", "patches")
    total_replaced = total_kept = 0

    for path in FILES:
        if mode == "--patch":
            before = base_text(src, path, patches_dir)
        else:
            with open(os.path.join(src, path), encoding="utf-8") as f:
                before = f.read()
        after, replaced, kept = rebrand(before)
        total_replaced += replaced
        total_kept += kept

        if mode == "--patch" and after != before:
            with tempfile.TemporaryDirectory() as tmp:
                a, b = os.path.join(tmp, "a"), os.path.join(tmp, "b")
                with open(a, "w", encoding="utf-8") as f:
                    f.write(before)
                with open(b, "w", encoding="utf-8") as f:
                    f.write(after)
                diff = subprocess.run(
                    ["diff", "-u", f"--label=a/{path}", f"--label=b/{path}",
                     a, b], capture_output=True, text=True).stdout
            sys.stdout.write(diff)
        elif mode == "--apply" and after != before:
            with open(os.path.join(src, path), "w", encoding="utf-8") as f:
                f.write(after)
        elif mode == "--report":
            for word in ("Chromium", "Chrome", "Google"):
                names = visible_words(after, word)
                if names:
                    print(f"{path}: {len(names)} with {word}")
                    for n in names:
                        print(f"    {n}")

    print(f"replaced {total_replaced}, kept {total_kept}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
