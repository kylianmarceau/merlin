#!/usr/bin/env python3
"""Record reproducible source/image hashes after a successful browser-test run."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path,
                        default=ROOT / 'docs/visual-identity-evidence')
    parser.add_argument('--extra-summary', type=Path, action='append', default=[])
    args = parser.parse_args()
    summaries = [args.directory / 'browser-tests.json', *args.extra_summary]
    results = {}
    for path in summaries:
        summary = json.loads(path.read_text())
        for iteration in summary['per_iteration_data']:
            for name, runs in iteration.items():
                if not runs or any(run['status'] != 'SUCCESS' for run in runs):
                    raise SystemExit('Cannot record a qualified automated run: ' + name)
                results[name] = [run['elapsed_time_ms'] for run in runs]
    if not results:
        raise SystemExit('No browser test results')
    images = {}
    for path in sorted(args.directory.glob('*.png')):
        data = path.read_bytes()
        if data[:8] != b'\x89PNG\r\n\x1a\n':
            raise SystemExit('Invalid PNG: ' + str(path))
        width, height = struct.unpack('>II', data[16:24])
        images[path.name] = {'width': width, 'height': height, 'sha256': sha(path)}
    # Hash compiled overlays and patches, including the pre-existing baseline.
    # This is provenance, not a claim that every file was changed by this task.
    sources = {}
    for directory in ('overlay/chrome/browser/ui/modal_browser', 'patches', 'branding'):
        for path in sorted((ROOT / directory).rglob('*')):
            if path.is_file():
                sources[path.relative_to(ROOT).as_posix()] = sha(path)
    manifest = {
        'recorded_utc': datetime.now(timezone.utc).isoformat(),
        'branch': subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip(),
        'base_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'working_tree': 'uncommitted; includes pre-existing maintainer work',
        'chromium_pin': (ROOT / 'UPSTREAM_PIN').read_text(),
        'browser_tests': results,
        'test_summary_files': [path.name for path in summaries],
        'screenshots': images,
        'source_sha256': sources,
        'qualification': 'automated samples only; manual state matrix remains open',
    }
    (args.directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Recorded {len(results)} passing tests and {len(images)} screenshots.')


if __name__ == '__main__':
    main()
