#!/usr/bin/env python3
"""Summarize native-blocker spans in retained DevTools JSON traces (milliseconds)."""
import argparse
from collections import defaultdict
import gzip
import json
import math
from pathlib import Path
import statistics

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('traces', type=Path, nargs='+')
args = parser.parse_args()


def percentile(values, q):
    values = sorted(values)
    at = (len(values) - 1) * q
    low = math.floor(at)
    return values[low] + (values[min(low + 1, len(values) - 1)] - values[low]) * (at - low)


output = {}
for path in args.traces:
    if path.suffix == '.gz':
        with gzip.open(path, 'rt') as source:
            data = json.load(source)
    else:
        data = json.loads(path.read_text())
    events = data.get('traceEvents', []) if isinstance(data, dict) else data
    stacks = defaultdict(list)
    durations = defaultdict(list)

    def record(start, end):
        name = start.get('name', '')
        value = (end - start.get('ts', end)) / 1000
        if name.startswith('MerlinAdblock.') and math.isfinite(value) and value >= 0:
            durations[name].append(value)

    for event in events:
        phase = event.get('ph')
        if phase == 'X':
            record(event, event.get('ts', 0) + event.get('dur', 0))
        elif phase in ('B', 'E', 'b', 'e', 'S', 'F'):
            if phase in ('B', 'E'):
                key = ('thread', event.get('pid'), event.get('tid'))
            else:
                key = ('async', event.get('pid'), event.get('cat'),
                       json.dumps(event.get('id2', event.get('id')), sort_keys=True))
            if phase in ('B', 'b', 'S'):
                stacks[key].append(event)
            elif stacks[key]:
                record(stacks[key].pop(), event.get('ts', 0))
    output[str(path)] = {
        'unit': 'milliseconds',
        'percentile_method': 'R7 linear interpolation',
        'spans': {name: {
            'n': len(values),
            'min': round(min(values), 4),
            'median': round(statistics.median(values), 4),
            'p95': round(percentile(values, .95), 4),
            'max': round(max(values), 4),
        } for name, values in sorted(durations.items())},
        'unclosed_blocker_spans': sum(
            event.get('name', '').startswith('MerlinAdblock.')
            for stack in stacks.values() for event in stack),
    }
print(json.dumps(output, indent=2))
