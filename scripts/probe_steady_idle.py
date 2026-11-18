#!/usr/bin/env python3
"""Idle CPU and wakeups of an assembled Merlin once it is really idle (remediation plan 7.7).

The benchmark's idle step (benchmark_browsers.mjs, memory-idle) samples 15 to
45 seconds after a new profile's first launch, while Chromium is still
downloading components and the ad blocker building its rules, so it measures
start-up work as much as idle. This starts a throwaway profile with the e2e
harness, lets it finish that first-run work, quits and starts it again, waits
for the start page to go quiet, and then samples every process with top.

    python3 scripts/probe_steady_idle.py [SETTLE_S] [SAMPLE_S] [FIRST_RUN_S]
    MERLIN_APP=/Applications/Merlin.app MERLIN_E2E_ALLOW_OTHER_BUILD=1 python3 scripts/probe_steady_idle.py

Defaults: 240 s of settling after the restart, a 60 s sample and 300 s of
first run. Prints one JSON line. The harness's instance runs hidden, with
background-timer throttling off, so a renderer's wakeups read higher than in
a window a person is looking at.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tests/e2e"))
from merlin_e2e import Merlin, PageServer  # noqa: E402


def tree(m: Merlin) -> dict[int, str]:
    out = subprocess.run(["ps", "-axo", "pid=,args="], capture_output=True, text=True).stdout
    procs = {}
    for line in out.splitlines():
        pid, _, args = line.strip().partition(" ")
        if str(m.profile) in args:
            kind = ("browser" if "--type=" not in args else "gpu" if "gpu-process" in args
                    else "renderer" if "--type=renderer" in args else "other")
            procs[int(pid)] = kind
    return procs


def main() -> None:
    settle, seconds, first_run = (int(a) for a in (sys.argv[1:] + ["240", "60", "300"][len(sys.argv) - 1:])[:3])
    server = PageServer()
    m = Merlin(server)
    try:
        if first_run:
            time.sleep(first_run)
            m.restart()
        m.cdp.close()
        time.sleep(settle)
        procs = tree(m)
        args = ["top", "-l", "2", "-s", str(seconds), "-stats", "pid,cpu,idlew"]
        for pid in procs:
            args += ["-pid", str(pid)]
        last = subprocess.run(args, capture_output=True, text=True).stdout.split("PID")[-1].splitlines()[1:]
        by: dict[str, list[float]] = {}
        for line in last:
            fields = line.split()
            if len(fields) < 3 or not fields[0].isdigit():
                continue
            slot = by.setdefault(procs.get(int(fields[0]), "other"), [0.0, 0.0])
            slot[0] += float(fields[1])
            slot[1] += float(fields[2].rstrip("+")) / seconds
        print(json.dumps({
            "app": str(m.app), "settle_s": settle, "sample_s": seconds, "first_run_s": first_run,
            "cpu_percent": round(sum(v[0] for v in by.values()), 2),
            "wakeups_per_s": round(sum(v[1] for v in by.values()), 2),
            "by_kind": {k: {"cpu_percent": round(v[0], 2), "wakeups_per_s": round(v[1], 2)} for k, v in by.items()},
        }))
    finally:
        m.close()
        server.close()


if __name__ == "__main__":
    main()
