#!/usr/bin/env python3
"""Attribute QA native heap samples with local Mach-O symbols; no cloud symbols."""
import argparse
from collections import defaultdict
import gzip
import json
from pathlib import Path
import re
import subprocess


def read(path):
    if path.suffix == '.gz':
        with gzip.open(path, 'rt') as source:
            return json.load(source)
    return json.loads(path.read_text())


def symbolize(records, build):
    addresses = defaultdict(set)
    for record in records:
        for snapshot in record['snapshots']:
            profiles = [snapshot['browser']] + [r['native'] for r in snapshot.get('renderers', [])]
            for profile in profiles:
                for module in profile['modules']:
                    # Browser/renderer integration and Rust are linked here.
                    if module['name'] != 'libchrome_dll.dylib':
                        continue
                    base = int(module['baseAddress'], 16)
                    end = base + module['size']
                    for _, _, stack_id in profile['samples']:
                        addresses[(module['name'], module['baseAddress'])].update(
                            frame for frame in record['stacks'][stack_id]
                            if frame.startswith('0x') and base <= int(frame, 16) < end)
    offsets = defaultdict(dict)
    for (name, base), frames in addresses.items():
        for frame in frames:
            offset = hex(int(frame, 16) - int(base, 16))
            offsets[name].setdefault(offset, []).append((base, frame))
    symbols = {}
    identifiers = {}
    for name, locations in offsets.items():
        frames = sorted(locations)
        binary = build / name
        if not binary.is_file():
            raise RuntimeError(f'Missing local symbol binary: {binary}')
        if name not in identifiers:
            identifier = subprocess.run(['xcrun', 'dwarfdump', '--uuid', str(binary)],
                                        check=True, text=True, stdout=subprocess.PIPE).stdout
            identifiers[name] = re.search(r'UUID: ([0-9A-Fa-f-]+)', identifier).group(1).replace('-', '').lower()
        uuid = identifiers[name]
        expected = {m['uuid'].replace('-', '').lower()[:32] for record in records
                    for snapshot in record['snapshots']
                    for profile in [snapshot['browser']] + [r['native'] for r in snapshot.get('renderers', [])]
                    for m in profile['modules'] if m['name'] == name}
        if expected != {uuid}:
            raise RuntimeError(f'Symbol binary UUID mismatch for {name}: {uuid} vs {expected}')
        for start in range(0, len(frames), 4096):
            batch = frames[start:start + 4096]
            answer = subprocess.run(
                ['atos', '-o', str(binary), '-l', '0x0', *batch],
                check=True, stdout=subprocess.PIPE, text=True).stdout.splitlines()
            if len(answer) != len(batch):
                raise RuntimeError('Symbolizer returned an incomplete batch')
            for offset, symbol in zip(batch, answer):
                symbols.update((key, symbol) for key in locations[offset])
    return symbols


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('--build', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    data = read(args.report)
    if not data.get('valid'):
        raise RuntimeError('Refusing an incomplete memory run')
    records = data['native_memory']
    symbols = symbolize(records, args.build)
    output = {'sampling_interval_bytes': 4096, 'modes': {}, 'limits': [
        'Poisson-sampled live allocation estimates, not exact owned-byte accounting.',
        'Feature attribution includes stacks with merlin_adblock or MerlinAdblock; asynchronous V8/DOM work is also covered by whole-renderer totals.',
        'Replacement peaks are observed lower bounds at approximately 100 ms intervals.',
        'RSS and private footprint include mappings and allocator reservation and are reported separately from sampled ownership.',
    ]}
    for record in records:
        snapshots = []
        def summarize(profile):
            total = feature = sampled = 0
            sites = defaultdict(int)
            module = next((m for m in profile['modules'] if m['name'] == 'libchrome_dll.dylib'), {})
            base = module.get('baseAddress', '')
            for size, weight, stack_id in profile['samples']:
                stack = [symbols.get((base, frame), frame) for frame in record['stacks'][stack_id]]
                if stack == ['<V8 Heap>']:
                    continue
                total += weight
                owned = [frame for frame in stack
                         if 'merlin_adblock' in frame or 'MerlinAdblock' in frame]
                if owned:
                    feature += weight
                    sampled += size
                    sites[owned[-1]] += weight
            return {
                'total_native_estimated_bytes': total,
                'feature_native_estimated_bytes': feature,
                'feature_sampled_allocation_bytes': sampled,
                'feature_allocation_sites': sorted(sites.items(), key=lambda x: -x[1]),
            }
        for snapshot in record['snapshots']:
            result = {'label': snapshot['label'], 'elapsed_ms': snapshot['elapsed_ms'],
                      'browser': summarize(snapshot['browser'])}
            if 'renderers' in snapshot:
                renderers = snapshot['renderers']
                # Separate targets may share one process/isolate. Native module
                # load-address fingerprints detect that before adding totals.
                fingerprints = [tuple((m['name'], m['baseAddress'])
                                      for m in sorted(r['native']['modules'], key=lambda m: m['name']))
                                for r in renderers]
                unique = {}
                for key, renderer in zip(fingerprints, renderers):
                    unique.setdefault(key, renderer)
                summaries = [summarize(r['native']) for r in unique.values()]
                result['renderers'] = {
                    'targets': len(renderers), 'unique_module_layouts': len(unique),
                    'feature_native_estimated_bytes': sum(r['feature_native_estimated_bytes'] for r in summaries),
                    'total_native_estimated_bytes': sum(r['total_native_estimated_bytes'] for r in summaries),
                    'javascript_used_bytes': sum(r['javascript']['usedSize'] for r in unique.values()),
                    'javascript_total_bytes': sum(r['javascript']['totalSize'] for r in unique.values()),
                    'dom_nodes': sum(r['dom']['nodes'] for r in unique.values()),
                }
                result['memory_dump'] = snapshot['memory_dump']
            snapshots.append(result)
        output['modes'][record['mode']] = {
            'snapshots': snapshots,
            'observed_peak_feature_browser_bytes': max(s['browser']['feature_native_estimated_bytes'] for s in snapshots),
        }
    for record in records:
        trace = read(Path(record['trace']))
        dumps = []
        for event in trace['traceEvents']:
            if event.get('ph') != 'v':
                continue
            args_ = event.get('args', {}).get('dumps', {})
            if 'process_totals' in args_:
                dumps.append({'pid': event.get('pid'), 'id': event.get('id'),
                              'process_totals': args_['process_totals']})
        output['modes'][record['mode']]['process_memory_dump_totals'] = dumps
    args.output.write_text(json.dumps(output, indent=2) + '\n')
    for mode, record in output['modes'].items():
        steady = [(s['label'], round(s['browser']['feature_native_estimated_bytes'] / 1048576, 2))
                  for s in record['snapshots'] if not s['label'].startswith('replacement_')]
        print(mode, 'browser-owned MiB:', steady,
              'observed peak MiB:', round(record['observed_peak_feature_browser_bytes'] / 1048576, 2))


if __name__ == '__main__':
    main()
