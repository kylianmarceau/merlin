#!/usr/bin/env python3
"""Launch-time and memory baseline for a local Merlin (or Chromium) build.

Usage:
  scripts/baseline.py <path/to/Merlin.app> [--runs 5] [--tabs 10] [--arg=--some-switch]

What it measures (no network, no automation port):
  * launch-to-load: wall time from exec until a local test page's onload
    handler calls back to a local HTTP server. "first" uses a brand-new
    profile; "warm" relaunches with the same profile. True cold-cache
    launches need `sudo purge` and are not attempted.
  * memory: total RSS of the browser process tree after 15 s idle, with one
    tab and with N tabs. RSS over-counts shared pages; use it to compare
    builds on the same machine, not as an absolute footprint.
"""

import argparse
import http.server
import os
import shutil
import signal
import statistics
import subprocess
import sys
import tempfile
import threading
import time

PAGE = b"""<!doctype html><title>baseline</title>
<h1>baseline page</h1><p>Lorem ipsum dolor sit amet.</p>
<script>onload = () => fetch('/loaded?' + location.search.slice(1));</script>"""


class Handler(http.server.BaseHTTPRequestHandler):
    loaded = threading.Event()

    def do_GET(self):
        if self.path.startswith("/loaded"):
            Handler.loaded.set()
            self.send_response(204)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *args):
        pass


def tree_rss_mb(root_pid):
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    children, rss = {}, {}
    for line in out.splitlines():
        pid, ppid, kb = (int(x) for x in line.split())
        children.setdefault(ppid, []).append(pid)
        rss[pid] = kb
    total, stack = 0, [root_pid]
    while stack:
        pid = stack.pop()
        total += rss.get(pid, 0)
        stack.extend(children.get(pid, []))
    return total / 1024


EXTRA_ARGS = []


def launch(binary, profile, urls):
    args = [binary, f"--user-data-dir={profile}", "--no-first-run",
            "--no-default-browser-check", "--disable-sync", *EXTRA_ARGS, *urls]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop(proc):
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    time.sleep(2)


def time_to_load(binary, profile, url):
    Handler.loaded.clear()
    start = time.monotonic()
    proc = launch(binary, profile, [url])
    ok = Handler.loaded.wait(timeout=120)
    elapsed = time.monotonic() - start
    stop(proc)
    if not ok:
        raise RuntimeError("page never loaded")
    return elapsed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("app")
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--tabs", type=int, default=10)
    ap.add_argument("--arg", action="append", default=[],
                    help="extra browser switch, e.g. --arg=--modal-browser-upstream-defaults")
    a = ap.parse_args()
    EXTRA_ARGS.extend(a.arg)
    # Merlin.app runs Contents/MacOS/Merlin; a stock Chromium.app, Chromium.
    name = os.path.splitext(os.path.basename(os.path.normpath(a.app)))[0]
    binary = os.path.join(a.app, "Contents", "MacOS", name)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}/page"

    first, warm = [], []
    for _ in range(a.runs):
        profile = tempfile.mkdtemp(prefix="baseline-")
        first.append(time_to_load(binary, profile, base + "?first"))
        warm.append(time_to_load(binary, profile, base + "?warm"))
        shutil.rmtree(profile, ignore_errors=True)

    mem = {}
    for n in (1, a.tabs):
        profile = tempfile.mkdtemp(prefix="baseline-")
        proc = launch(binary, profile, [f"{base}?tab{i}" for i in range(n)])
        time.sleep(15)
        mem[n] = tree_rss_mb(proc.pid)
        stop(proc)
        shutil.rmtree(profile, ignore_errors=True)

    def fmt(xs):
        return f"median {statistics.median(xs):.2f}s (min {min(xs):.2f}, max {max(xs):.2f}, n={len(xs)})"

    print(f"launch-to-load, new profile:  {fmt(first)}")
    print(f"launch-to-load, warm profile: {fmt(warm)}")
    for n, mb in mem.items():
        print(f"process-tree RSS, {n} tab(s), 15 s idle: {mb:.0f} MB")
    server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
