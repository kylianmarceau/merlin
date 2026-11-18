#!/usr/bin/env python3
"""Merlin's interface with many tabs and a long history (remediation plan 7.4, M36).

Measures, before anyone virtualizes a list:

- the sidebar at 10, 100 and 500 tabs: how long the shell takes from a
  snapshot's arrival to React's commit (the trace's "snapshot-commit" lines,
  written by the shell when MERLIN_STARTUP_TRACE is set), and the browser
  process's CPU per tab switch;
- History with 5,000 visits: how long Chromium takes to answer the first
  page, and every page after it, of the Library's history list
  (history.search, 100 rows a page; the shell renders one page at a time).

Runs an assembled Merlin.app with the e2e harness (a throwaway profile, in
the background):

    python3 scripts/probe_large_libraries.py [--tabs 10,100,500] [--history 5000]

Prints a JSON summary. Leave the Mac alone while it runs.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests/e2e"))
from merlin_e2e import Merlin, PageServer, wait_until  # noqa: E402


def browser_pid(m: Merlin) -> int:
    out = subprocess.run(["ps", "-axo", "pid=,args="], capture_output=True, text=True).stdout
    for line in out.splitlines():
        pid, _, args = line.strip().partition(" ")
        if f"--user-data-dir={m.profile}" in args and "--type=" not in args:
            return int(pid)
    raise RuntimeError("no browser process")


def cpu_seconds(pid: int) -> float:
    """User and system CPU time of one process so far."""
    text = subprocess.run(["ps", "-o", "cputime=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    parts = [float(p) for p in text.replace("-", ":").split(":")]
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + part
    return seconds


def commits(trace: Path, start: int) -> list[tuple[float, int]]:
    """(ms, tabs) of every snapshot-commit line after line `start`."""
    lines = trace.read_text().splitlines()[start:] if trace.exists() else []
    found = []
    for line in lines:
        words = line.split()
        if words and words[0] == "snapshot-commit":
            fields = dict(w.split("=", 1) for w in words[2:] if "=" in w)
            found.append((float(words[1]), int(fields.get("tabs", 0))))
    return found


def line_count(trace: Path) -> int:
    return len(trace.read_text().splitlines()) if trace.exists() else 0


def measure_tabs(m: Merlin, server: PageServer, counts: list[int], trace: Path) -> dict:
    results = {}
    for target in counts:
        while len(m.tabs()) < target:
            n = len(m.tabs())
            m.cdp.call("Target.createTarget", {"url": server.url(f"/icon-page?tab{n}"), "background": True})
        wait_until(lambda: len(m.tabs()) >= target, timeout=600, message=f"{target} tabs")
        time.sleep(15)  # loads settle, Memory Saver does what it does
        pid = browser_pid(m)
        # Idle with this many tabs.
        before, start = cpu_seconds(pid), time.monotonic()
        time.sleep(10)
        idle = (cpu_seconds(pid) - before) / (time.monotonic() - start) * 100
        # Ten switches across the list, as Control-Tab or a click would.
        tabs = m.tabs()
        mark = line_count(trace)
        before = cpu_seconds(pid)
        for i in range(10):
            m.browserctl("focus", tab=(i * 37) % len(tabs) + 1)  # 1-based, as browserctl counts
            time.sleep(0.6)
        per_switch = (cpu_seconds(pid) - before) / 10 * 1000
        seen = [ms for ms, tabs_in in commits(trace, mark) if tabs_in >= target]
        results[str(target)] = {
            "snapshot_commit_ms_median": round(statistics.median(seen), 1) if seen else None,
            "snapshot_commit_ms_max": round(max(seen), 1) if seen else None,
            "snapshots": len(seen),
            "browser_cpu_ms_per_switch": round(per_switch, 1),
            "browser_cpu_percent_idle": round(idle, 2),
        }
        print(f"{target} tabs: {results[str(target)]}", file=sys.stderr)
    return results


def fill_history(m: Merlin, server: PageServer, visits: int) -> None:
    """Writes `visits` visits into the profile's History database, with Merlin quit."""
    m.open("/page")  # Chromium creates the database with its first visit
    time.sleep(3)
    m.cdp.call("Browser.close", timeout=10)
    m.cdp.close()
    marker = f"--user-data-dir={m.profile}"
    wait_until(lambda: subprocess.run(["pgrep", "-f", "--", marker], capture_output=True).returncode != 0,
               timeout=30, message="Merlin to quit")
    (m.profile / "DevToolsActivePort").unlink(missing_ok=True)
    db = sqlite3.connect(m.profile / "Default/History")
    # Chromium's times: microseconds since 1601. Spread over the last 60 days.
    now = int((time.time() + 11644473600) * 1_000_000)
    span = 60 * 24 * 3600 * 1_000_000
    for i in range(visits):
        when = now - span * i // visits
        url = server.url(f"/icon-page?visit{i}")
        cur = db.execute("INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) "
                         "VALUES (?, ?, 1, 0, ?, 0)", (url, f"Visited page {i}", when))
        db.execute("INSERT INTO visits (url, visit_time, from_visit, transition, segment_id, visit_duration) "
                   "VALUES (?, ?, 0, 805306368, 0, 0)", (cur.lastrowid, when))
    db.commit()
    db.close()
    m._launch()


def measure_history(m: Merlin) -> dict:
    def page(before: int | None = None) -> tuple[float, dict]:
        args = {"text": ""} | ({"before": before} if before else {})
        start = time.monotonic()
        reply = m.shell_call("history.search", args)
        assert reply.get("ok"), reply
        return (time.monotonic() - start) * 1000, reply["result"]

    first_ms, first = page()
    times, rows, result = [first_ms], len(first["items"]), first
    while not result["done"] and result["items"]:
        ms, result = page(result["items"][-1]["time"])
        times.append(ms)
        rows += len(result["items"])
    start = time.monotonic()
    assert m.shell_call("history.search", {"text": "page 4"}).get("ok")
    searched_ms = (time.monotonic() - start) * 1000
    return {"rows": rows, "pages": len(times), "first_page_ms": round(first_ms, 1),
            "page_ms_median": round(statistics.median(times), 1), "all_pages_ms": round(sum(times), 1),
            "search_ms": round(searched_ms, 1)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tabs", default="10,100,500")
    parser.add_argument("--history", type=int, default=5000)
    options = parser.parse_args()
    trace = Path(tempfile.mkdtemp(prefix="merlin-probe-")) / "trace.txt"
    server = PageServer()
    summary: dict = {}
    m = Merlin(server, extra_env={"MERLIN_STARTUP_TRACE": str(trace)})
    try:
        summary["tabs"] = measure_tabs(m, server, [int(n) for n in options.tabs.split(",")], trace)
    finally:
        m.close()
    m = Merlin(server)
    try:
        fill_history(m, server, options.history)
        summary["history"] = measure_history(m)
    finally:
        m.close()
        server.close()
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
