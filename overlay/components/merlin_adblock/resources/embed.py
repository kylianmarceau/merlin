#!/usr/bin/env python3
"""Embed checksum-verified, compressed offline data in the browser binary."""
import gzip
import hashlib
import json
from pathlib import Path
import sys

root, header, implementation = map(Path, sys.argv[1:])
manifest = json.loads((root / 'manifest.json').read_text())
assets = [('manifest.json', None)] + [(s['file'], s['sha256']) for s in manifest['sources']] + [(manifest['resources']['file'], manifest['resources']['sha256'])]
declarations = []
entries = []
for index, (name, expected) in enumerate(assets):
    data = (root / name).read_bytes()
    if expected and hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit('bundled digest mismatch: ' + name)
    data = gzip.compress(data, mtime=0)
    declarations.append('constexpr uint8_t kAsset%d[] = {%s};' % (index, ','.join(map(str, data))))
    entries.append('  {%s, kAsset%d},' % (json.dumps(name), index))
header.parent.mkdir(parents=True, exist_ok=True)
header.write_text('''#ifndef COMPONENTS_MERLIN_ADBLOCK_RESOURCES_BUNDLED_DATA_H_
#define COMPONENTS_MERLIN_ADBLOCK_RESOURCES_BUNDLED_DATA_H_
#include <string>
#include <string_view>
namespace merlin_adblock {
std::string ReadBundledAsset(std::string_view name);
}
#endif
''')
implementation.write_text('''#include "components/merlin_adblock/resources/bundled_data.h"
#include <cstdint>
#include "base/containers/span.h"
#include "third_party/zlib/google/compression_utils.h"
namespace merlin_adblock {
namespace {
''' + '\n'.join(declarations) + '''
struct Asset { std::string_view name; base::span<const uint8_t> bytes; };
constexpr Asset kAssets[] = {
''' + '\n'.join(entries) + '''
};
}
std::string ReadBundledAsset(std::string_view name) {
  for (const auto& asset : kAssets) {
    if (asset.name == name) {
      std::string result;
      if (compression::GzipUncompress(asset.bytes, &result)) return result;
      return {};
    }
  }
  return {};
}
}
''')
