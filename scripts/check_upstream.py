#!/usr/bin/env python3
"""Is the pinned Chromium behind the current Mac Stable release?

Reads UPSTREAM_PIN, asks chromiumdash for the latest Stable release on Mac,
and says whether a rebase is due. Stable releases carry the security fixes,
so the fork must follow them within days (docs/UPSTREAM.md, "Security
responsibility"). Exit codes: 0 up to date, 1 behind, 2 could not check.

    scripts/check_upstream.py            # human summary
    scripts/check_upstream.py --json     # for automation
"""
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = ("https://chromiumdash.appspot.com/fetch_releases"
       "?channel=Stable&platform=Mac&num=5")


def version_tuple(v):
    return tuple(int(p) for p in v.split("."))


def pinned():
    for line in (ROOT / "UPSTREAM_PIN").read_text().splitlines():
        if line.startswith("tag:"):
            return line.split(":", 1)[1].strip()
    sys.exit("UPSTREAM_PIN has no 'tag:' line")


def latest():
    with urllib.request.urlopen(URL, timeout=30) as response:
        releases = json.load(response)
    if not releases:
        raise RuntimeError("chromiumdash returned no releases")
    newest = max(releases, key=lambda r: version_tuple(r["version"]))
    return newest["version"], newest.get("hashes", {}).get("chromium", "")


def main():
    pin = pinned()
    try:
        version, commit = latest()
    except Exception as e:  # network, format
        print(f"could not check: {e}", file=sys.stderr)
        return 2
    behind = version_tuple(version) > version_tuple(pin)
    if "--json" in sys.argv:
        print(json.dumps({"pinned": pin, "stable": version,
                          "stable_commit": commit, "rebase_due": behind}))
    elif behind:
        same_milestone = pin.split(".")[0] == version.split(".")[0]
        print(f"Rebase due: pinned {pin}, Mac Stable is {version} ({commit}).")
        print("  Same milestone: a security/bug-fix update; follow"
              if same_milestone else
              "  New milestone: expect API changes; follow")
        print("  docs/UPSTREAM.md 'Rebase procedure'.")
    else:
        print(f"Up to date: pinned {pin} is the current Mac Stable.")
    return 1 if behind else 0


if __name__ == "__main__":
    sys.exit(main())
