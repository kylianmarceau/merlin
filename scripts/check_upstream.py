#!/usr/bin/env python3
"""Is the pinned Chromium behind the current Mac Stable release?

Reads UPSTREAM_PIN, asks chromiumdash for the latest Stable release on Mac,
and says whether a rebase is due. Stable releases carry the security fixes,
so the fork must follow them within days (docs/UPSTREAM.md, "Security
responsibility"). Exit codes: 0 exact current Stable version/commit, 1 behind,
2 unconfirmed (ahead, commit mismatch, invalid data or a failed check).

    scripts/check_upstream.py            # human summary
    scripts/check_upstream.py --json     # for automation
"""
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = ("https://chromiumdash.appspot.com/fetch_releases"
       "?channel=Stable&platform=Mac&num=5")


def version_tuple(v):
    if not isinstance(v, str) or not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", v):
        raise ValueError("invalid Chromium version")
    return tuple(int(p) for p in v.split("."))


def pinned():
    fields = dict(line.split(":", 1) for line in
                  (ROOT / "UPSTREAM_PIN").read_text().splitlines() if ":" in line)
    tag = fields.get("tag", "").strip()
    commit = fields.get("commit", "").strip().lower()
    version_tuple(tag)
    validate_commit(commit)
    return tag, commit


def validate_commit(commit):
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("missing or invalid Chromium commit")


def latest():
    with urllib.request.urlopen(URL, timeout=30) as response:
        releases = json.load(response)
    if not releases:
        raise RuntimeError("chromiumdash returned no releases")
    for release in releases:
        if release.get("channel") != "Stable" or release.get("platform") != "Mac":
            raise ValueError("chromiumdash returned a release outside Mac Stable")
        version_tuple(release.get("version"))
    newest = max(releases, key=lambda r: version_tuple(r["version"]))
    commit = newest.get("hashes", {}).get("chromium", "")
    validate_commit(commit)
    return newest["version"], commit


def compare(pin, pin_commit, version, commit):
    if version_tuple(pin) < version_tuple(version):
        return "behind", 1
    if version_tuple(pin) > version_tuple(version):
        return "ahead", 2
    return ("current", 0) if pin_commit == commit else ("commit_mismatch", 2)


def main():
    try:
        pin, pin_commit = pinned()
        version, commit = latest()
        status, code = compare(pin, pin_commit, version, commit)
    except Exception as e:  # network, format
        if "--json" in sys.argv:
            print(json.dumps({"status": "error", "error": str(e),
                              "rebase_due": None}))
        print(f"could not check: {e}", file=sys.stderr)
        return 2
    if "--json" in sys.argv:
        print(json.dumps({"pinned": pin, "stable": version,
                          "pinned_commit": pin_commit, "stable_commit": commit,
                          "status": status, "rebase_due": status == "behind"}))
    elif status == "behind":
        same_milestone = pin.split(".")[0] == version.split(".")[0]
        print(f"Rebase due: pinned {pin}, Mac Stable is {version} ({commit}).")
        print("  Same milestone: a security/bug-fix update; follow"
              if same_milestone else
              "  New milestone: expect API changes; follow")
        print("  docs/UPSTREAM.md 'Rebase procedure'.")
    elif status == "current":
        print(f"Up to date: pinned {pin} ({pin_commit}) matches current Mac Stable.")
    elif status == "ahead":
        print(f"Unconfirmed: pinned {pin} is ahead of Mac Stable {version} ({commit}).")
        print("  Version ordering does not establish Stable membership; review the pin and channel.")
    else:
        print(f"Commit mismatch: {pin} is Mac Stable, but the pinned commit differs.")
        print(f"  Pinned: {pin_commit}; Mac Stable: {commit}. Review UPSTREAM_PIN.")
    return code


if __name__ == "__main__":
    sys.exit(main())
