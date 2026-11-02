#!/usr/bin/env python3
"""Prepare Brave's pinned dependencies with Chromium's own gnrt tooling.

Run after applying the overlay. Existing Chromium crates retain their locked
versions; gnrt vendors additions, preserves Chromium patches, and generates
GN targets plus README.chromium/license metadata. Nothing is git-added.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def verify_crates(src, release):
    entries = json.loads((release / 'crates.json').read_text())
    caches = list((src / 'out/gnrt/target/cargo_home/registry/cache').glob('*'))
    caches += list((Path.home() / '.cargo/registry/cache').glob('*'))
    with tempfile.TemporaryDirectory(prefix='merlin-crate-checks-') as temporary:
        for entry in entries:
            name, version = entry['name'], entry['version']
            filename = f'{name}-{version}.crate'
            archive = next((cache / filename for cache in caches if (cache / filename).is_file()), None)
            if archive is None:
                archive = Path(temporary) / filename
                subprocess.run(['curl', '--fail', '--location', '--proto', '=https', '--max-time', '60', '--max-filesize', '20971520', f'https://static.crates.io/crates/{name}/{filename}', '--output', str(archive)], check=True)
            if hashlib.sha256(archive.read_bytes()).hexdigest() != entry['sha256']:
                raise SystemExit('Crate archive digest mismatch: ' + filename)
            parts = version.split('.')
            epoch = 'v' + (parts[0] if parts[0] != '0' else '_'.join(parts[:2]))
            vendor = src / 'third_party/rust/chromium_crates_io/vendor' / f'{name}-{epoch}'
            expected = entry.get('gnrt_placeholder', entry['rust_sources'])
            for file, digest in expected.items():
                if hashlib.sha256((vendor / file).read_bytes()).hexdigest() != digest:
                    raise SystemExit(f'Vendored Rust source differs from audited archive: {name}/{file}')
    print(f'Verified {len(entries)} pinned crate archives and their Rust sources')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--src', type=Path, default=Path(os.environ.get('CHROMIUM_DIR', Path.home() / 'chromium')) / 'src')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    src = args.src.resolve()
    root = src / 'third_party/rust/chromium_crates_io'
    release = Path(__file__).resolve().parents[1] / 'build/adblock'
    metadata = json.loads((release / 'dependencies.json').read_text())
    if args.verify_only:
        verify_crates(src, release)
        return
    pin = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=src, text=True).strip()
    if pin != metadata['chromium_commit']:
        raise SystemExit('Chromium pin changed; audit dependencies and refresh the blocker lock before preparing')
    locked = (release / 'ChromiumCargo.lock').read_bytes()
    if hashlib.sha256(locked).hexdigest() != metadata['prepared_lock_sha256']:
        raise SystemExit('Blocker dependency lock digest mismatch')
    current = hashlib.sha256((root / 'Cargo.lock').read_bytes()).hexdigest()
    if current not in [metadata['baseline_lock_sha256'], metadata['prepared_lock_sha256']]:
        raise SystemExit('Chromium Rust lock has unrelated edits; merge and review them before preparing')
    manifest = root / 'Cargo.toml'
    text = manifest.read_text()
    # Procedural selectors require the upstream css-validation feature; the
    # default engine otherwise preserves them as unusable native CSS strings.
    text = text.replace('adblock = "=0.13.3"', 'adblock = { version = "=0.13.3", features = ["css-validation"] }')
    for name, version in [('adblock', '=0.13.3'), ('sha2', '=0.10.9')]:
        dependencies = text.split('[dependencies]\n', 1)[1].split('\n[', 1)[0]
        match = re.search(r'^' + re.escape(name) + r'\s*=\s*"([^"]+)"', dependencies, re.M)
        value = match[1] if match else None
        if value is not None and value != version:
            raise SystemExit(f'{name}: review conflicting existing dependency {value!r}')
        if value is None:
            declaration = '{ version = "=0.13.3", features = ["css-validation"] }' if name == 'adblock' else f'"{version}"'
            if not re.search(r'^' + re.escape(name) + r'\s*=', dependencies, re.M):
                text = text.replace('[dependencies]\n', f'[dependencies]\n{name} = {declaration}\n', 1)
    manifest.write_text(text)
    (root / 'Cargo.lock').write_bytes(locked)
    config = root / 'gnrt_config.toml'
    text = config.read_text()
    if '[crate.thiserror]\n' in text:
        text = text.replace('[crate.thiserror]\n', '[crate."thiserror@v2"]\n', 1)
        text += '\n[crate."thiserror@v1"]\ngroup = "safe"\nextra_kv = { allow_unsafe = true }\n'
    # Engine and resolver dependencies are production Rust code. The graph is
    # limited to the new dependency tree; unrelated test crates stay test-only.
    crates = ['adblock', 'addr', 'arrayvec', 'flatbuffers', 'idna', 'idna_adapter',
              'percent-encoding', 'psl', 'psl-types', 'regex', 'regex-automata',
              'regex-syntax', 'rustc-hash', 'seahash', 'sha2', 'digest',
              'block-buffer', 'crypto-common', 'generic-array', 'typenum',
              'cpufeatures', 'thiserror', 'thiserror-impl', 'utf8_iter',
              'cssparser', 'cssparser-macros', 'derive_more', 'derive_more-impl',
              'dtoa', 'dtoa-short', 'new_debug_unreachable', 'phf', 'phf_codegen',
              'phf_generator', 'phf_macros', 'phf_shared', 'rand', 'rand_core',
              'selectors', 'servo_arc', 'siphasher', 'precomputed-hash']
    sections = re.findall(r'^\[crate\.([^\]\n]+)\]', text, re.M)
    for name in crates:
        # Epoch-specific upstream settings need a deliberate merge, never a
        # second conflicting unversioned section.
        if any(k.strip('"').startswith(name + '@') for k in sections):
            continue
        if any(k == name or k.startswith(name + '.') for k in sections):
            pattern = r'(\[crate\.' + re.escape(name) + r'\]\n)(.*?)(?=\n\[|\Z)'
            match = re.search(pattern, text, re.S)
            if match:
                body = re.sub(r"^group\s*=.*$", "group = 'safe'", match[2], flags=re.M)
                if not re.search(r'^group\s*=', body, re.M):
                    body = "group = 'safe'\n" + body
                text = text[:match.start(2)] + body + text[match.end(2):]
            else:
                # Existing [crate.name.extra_kv] is compatible with this table.
                text += f"\n[crate.{name}]\ngroup = 'safe'\n"
        else:
            text += f"\n[crate.{name}]\ngroup = 'safe'\nextra_kv = {{ allow_unsafe = true }}\n"
    config.write_text(text)
    text = config.read_text()
    for name in ['derive_more', 'derive_more-impl']:
        section = f'[crate.{name}]\n'
        entry = 'extra_input_roots = ["../doc", "../README.md"]\n'
        text = text.replace(section + 'extra_input_roots = ["../doc"]\n', section + entry)
        if section + entry not in text:
            text = text.replace(section, section + entry, 1)
    config.write_text(text)
    text = config.read_text()
    for runtime in ['aho-corasick', 'rand_core']:
        text = config.read_text()
        match = re.search(r'(\[crate\.' + re.escape(runtime) + r'\]\n)(.*?)(?=\n\[|\Z)', text, re.S)
        if match:
            body = match[2].replace('allow_unsafe = false', 'allow_unsafe = true')
            config.write_text(text[:match.start(2)] + body + text[match.end(2):])
    # SeaHash's published crate omits its MIT notice. Preserve the notice
    # recovered from the upstream repository rather than fabricating one.
    text = config.read_text()
    for name, license_path in [('seahash', '../../../../../components/merlin_adblock/resources/licenses/SeaHash-MIT.txt'), ('flatbuffers', '../../../../flatbuffers/src/LICENSE'), ('selectors', '../../../../../components/merlin_adblock/resources/licenses/adblock-MPL-2.0.txt')]:
        entry = f'license_files = ["{license_path}"]'
        if entry not in text:
            section = f'[crate.{name}]\n'
            text = text.replace(section, section + entry + '\n', 1)
    if 'remove_build_rs = true # Merlin: use FlatBuffers stable implementation' not in text:
        text = text.replace('[crate.flatbuffers]\n', '[crate.flatbuffers]\nremove_build_rs = true # Merlin: use FlatBuffers stable implementation\nremove_deps = ["rustc_version"]\n', 1)
    config.write_text(text)
    text = config.read_text()
    section = '[crate.selectors]\n'
    entry = 'build_script_outputs = ["ascii_case_insensitive_html_attributes.rs"]\n'
    if section + entry not in text:
        text = text.replace(section, section + entry, 1)
    config.write_text(text)
    env = dict(os.environ)
    env['PATH'] = str(Path.home() / 'depot_tools') + os.pathsep + str(Path.home() / '.cargo/bin') + os.pathsep + env['PATH']
    for command in ['vendor', 'gen']:
        subprocess.run(['python3', 'tools/crates/run_gnrt.py', command], cwd=src, env=env, check=True)
    # GN's Rust environment escaping splits non-ASCII author names into byte
    # escapes, which Siso's protobuf spawn helper rejects as invalid UTF-8.
    # Escape that *build environment metadata* as ASCII character references;
    # retain the full original Cargo.toml and copyright/license notices.
    generated = src / 'third_party/rust/generic_array/v0_14/BUILD.gn'
    if generated.exists():
        text = generated.read_text()
        text = re.sub(r'cargo_pkg_authors = "[^"\n]*"', lambda m: m[0].encode('ascii', 'xmlcharrefreplace').decode('ascii'), text)
        generated.write_text(text)
    verify_crates(src, release)


if __name__ == '__main__':
    main()
