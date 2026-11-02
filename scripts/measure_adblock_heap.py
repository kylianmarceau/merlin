#!/usr/bin/env python3
"""Measure Rust-owned live allocations; this is not browser RSS or V8 memory.

The standalone probe instruments System allocation requests, including engine
resources and lazy regex caches. Its allocator is outside the production crate;
no Chromium allocator or runtime code is replaced. Cargo uses cached dependencies.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = r'''
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
use merlin_adblock_core::{Generation, List, ResourceType};
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
struct Tracked;
fn add(size: usize) {
    let live = LIVE.fetch_add(size, SeqCst) + size;
    PEAK.fetch_max(live, SeqCst);
}
// Forward every operation to System with the original layout. Counters record
// requested bytes only after successful allocations, and subtract before free.
unsafe impl GlobalAlloc for Tracked {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(layout) };
        if !p.is_null() { add(layout.size()); }
        p
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let p = unsafe { System.alloc_zeroed(layout) };
        if !p.is_null() { add(layout.size()); }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), SeqCst);
        unsafe { System.dealloc(p, layout) };
    }
    unsafe fn realloc(&self, p: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let result = unsafe { System.realloc(p, layout, size) };
        if !result.is_null() {
            LIVE.fetch_sub(layout.size(), SeqCst);
            add(size);
        }
        result
    }
}
#[global_allocator]
static ALLOCATOR: Tracked = Tracked;
fn build(root: &std::path::Path) -> Generation {
    let manifest: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("manifest.json")).unwrap()).unwrap();
    let resources = std::fs::read_to_string(root.join("resources.json")).unwrap();
    let lists: Vec<_> = manifest["sources"].as_array().unwrap().iter()
        .filter(|s| ["easylist", "easyprivacy", "ublock", "brave"]
            .contains(&s["group"].as_str().unwrap()))
        .map(|s| List {
            id: s["id"].as_str().unwrap().into(),
            text: std::fs::read_to_string(root.join(s["file"].as_str().unwrap())).unwrap(),
            permissions: s["permissions"].as_u64().unwrap() as u8,
        }).collect();
    Generation::build(&lists, &resources).unwrap()
}
fn exercise(engine: &Generation) {
    let source = "https://www.youtube.com/watch?v=local-fixture";
    for _ in 0..100 {
        for url in ["https://ad.doubleclick.net/pagead/ad.js", "https://example.com/content.js",
                    "https://www.youtube.com/api/stats/ads", "https://www.youtube.com/youtubei/v1/player"] {
            std::hint::black_box(engine.check(url, source, "GET", ResourceType::Script).unwrap());
        }
        std::hint::black_box(engine.cosmetics(source));
        std::hint::black_box(engine.generic_selectors(&["ad-banner".into()], &[], &[]).unwrap());
    }
}
fn main() {
    let root = std::path::PathBuf::from(std::env::args().nth(1).unwrap());
    let baseline = LIVE.load(SeqCst);
    PEAK.store(baseline, SeqCst);
    let engine = build(&root);
    let cold = LIVE.load(SeqCst) - baseline;
    let build_peak = PEAK.load(SeqCst) - baseline;
    exercise(&engine);
    let warm = LIVE.load(SeqCst) - baseline;
    let warm_peak = PEAK.load(SeqCst) - baseline;
    PEAK.store(LIVE.load(SeqCst), SeqCst);
    let candidate = build(&root);
    let update_peak = PEAK.load(SeqCst) - baseline;
    drop(engine);
    exercise(&candidate);
    let replaced = LIVE.load(SeqCst) - baseline;
    drop(candidate);
    let after_drop = LIVE.load(SeqCst) - baseline;
    println!("{}", serde_json::json!({
        "engine": merlin_adblock_core::ENGINE_VERSION,
        "cold_owned_bytes": cold, "warm_owned_bytes": warm,
        "build_peak_requested_bytes": build_peak,
        "exercise_peak_requested_bytes": warm_peak,
        "update_peak_requested_bytes": update_peak,
        "after_replacement_owned_bytes": replaced,
        "after_drop_retained_bytes": after_drop
    }));
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cargo", default="cargo")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="merlin-adblock-heap-") as directory:
        work = Path(directory)
        core = ROOT / "overlay/components/merlin_adblock/core"
        manifest = (
            '[package]\nname="merlin_adblock_heap_probe"\nversion="0.0.0"\n'
            'edition="2024"\n[workspace]\n[dependencies]\n'
            f'merlin_adblock_core={{path={json.dumps(str(core))}}}\n'
            'serde_json="=1.0.149"\n'
        )
        (work / "Cargo.toml").write_text(manifest)
        (work / "src").mkdir()
        (work / "src/main.rs").write_text(SOURCE)
        result = subprocess.run(
            [args.cargo, "run", "--offline", "--release", "--manifest-path",
             str(work / "Cargo.toml"), "--", str(core.parent / "resources")],
            check=True, text=True, stdout=subprocess.PIPE,
            env=dict(os.environ, CARGO_TARGET_DIR=str(ROOT / "target/heap-probe"),
                     CARGO_BUILD_JOBS=os.environ.get("CARGO_BUILD_JOBS", "4")),
        )
        data = json.loads(result.stdout)
        data["limitations"] = [
            "Requested live Rust allocation bytes, not allocator-reserved pages or RSS.",
            "Standalone release probe; excludes C++ buffers, V8 helpers, thread stacks and IPC.",
            "Peak realloc accounting excludes allocator-internal temporary copies.",
            "Fixed local request/DOM workload, not every possible regex or visited site.",
        ]
        args.output.write_text(json.dumps(data, indent=2) + "\n")
        print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
