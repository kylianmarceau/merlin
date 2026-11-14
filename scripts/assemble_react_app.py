#!/usr/bin/env python3
"""Assemble already-built Chromium and React Native products; never build them.

The Chromium app is the base so its helpers, framework versions, URL handlers,
icons and permission usage strings survive. Only the browser executable is
replaced. Signing is the packaging script's job.
"""
import argparse
import json
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path


def plist(path):
    with path.open('rb') as stream:
        return plistlib.load(stream)


def require_symbols(binary, names):
    result = subprocess.run(['xcrun', 'nm', '-gU', str(binary)], check=True,
                            capture_output=True, text=True)
    symbols = {line.split()[-1] for line in result.stdout.splitlines() if line.strip()}
    missing = set(names) - symbols
    if missing:
        raise ValueError(f'{binary} is missing {sorted(missing)}; rebuild that product with the shell sources')


REPO = Path(__file__).resolve().parent.parent


def stale_engine_sources(engine_app, shell_app):
    """Engine and host sources edited after the products were built.

    The engine comes from out/<dir>/Merlin.app inside a Chromium checkout:
    Merlin's overlay and every upstream file the patch series touches must be
    older than its framework. The app icon assets only reach the bundle's
    Resources, so they are checked against the copies there instead. The
    host's native and JS sources must be older than its executable. A stale
    engine once shipped without a crash fix.
    """
    framework = engine_app / 'Contents/Frameworks/Merlin Framework.framework/Merlin Framework'
    shell_info = plist(shell_app / 'Contents/Info.plist')
    executable = shell_app / 'Contents/MacOS' / shell_info['CFBundleExecutable']
    src = engine_app.parent.parent.parent  # <src>/out/<dir>/Merlin.app
    engine_sources = [path for path in (REPO / 'overlay').rglob('*')
                      if path.is_file() and path.name != '.DS_Store' and '/target/' not in str(path)]
    for patch in sorted((REPO / 'patches').glob('*.patch')):
        engine_sources.append(patch)
        for line in patch.read_text().splitlines():
            if line.startswith('+++ b/'):
                upstream = src / line[6:].split('\t')[0]
                if upstream.is_file():
                    engine_sources.append(upstream)
    host_sources = [path for root in ('apps/browser/src', 'apps/browser/macos/MerlinShell-macOS', 'packages/engine',
                                      'packages/shell', 'packages/webkit', 'pnpm-patches')
                    for path in (REPO / root).rglob('*')
                    if path.is_file() and path.name != '.DS_Store' and not path.name.endswith('.test.ts')]
    built_engine = framework.resolve().stat().st_mtime
    built_host = executable.stat().st_mtime
    icon_assets = REPO / 'overlay/chrome/app/theme/merlin/mac'
    copied = [engine_app / 'Contents/Resources' / name for name in ('Assets.car', 'app.icns')]
    built_icons = min((path.stat().st_mtime for path in copied if path.is_file()), default=built_engine)
    built = lambda path: built_icons if icon_assets in path.parents else built_engine
    return ([path for path in engine_sources if path.stat().st_mtime > built(path)],
            [path for path in host_sources if path.stat().st_mtime > built_host])


def merge_directory(source, destination):
    """Reject collisions instead of silently replacing engine resources."""
    if not source.exists():
        return
    destination.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        target = destination / item.name
        if target.exists() or target.is_symlink():
            raise ValueError(f'Conflicting resource: {target.name}')
        subprocess.run(['ditto', str(item), str(target)], check=True)


def assemble(engine_app, shell_app, destination, check_only=False, allow_stale=False):
    if destination.exists() or destination.is_symlink():
        raise ValueError(f'Destination already exists: {destination}. Choose a fresh output directory.')
    for source in (engine_app, shell_app):
        if destination == source or destination in source.parents or source in destination.parents:
            raise ValueError('Output and input app paths must not overlap')
    engine_info = plist(engine_app / 'Contents/Info.plist')
    shell_info = plist(shell_app / 'Contents/Info.plist')
    if engine_info['CFBundleIdentifier'] != shell_info['CFBundleIdentifier']:
        raise ValueError('Chromium and React host bundle identifiers must match')
    framework = engine_app / 'Contents/Frameworks/Merlin Framework.framework/Merlin Framework'
    executable = shell_app / 'Contents/MacOS' / shell_info['CFBundleExecutable']
    if not allow_stale:
        engine_newer, host_newer = stale_engine_sources(engine_app, shell_app)
        for name, newer, fix in (('engine', engine_newer, 'rebuild Chromium (autoninja -C out/Release chrome)'),
                                 ('React host', host_newer, 'run scripts/build_react_shell.sh')):
            if newer:
                shown = ', '.join(str(path.relative_to(REPO) if REPO in path.parents else path) for path in newer[:5])
                more = f' and {len(newer) - 5} more' if len(newer) > 5 else ''
                raise ValueError(f'The {name} is older than its sources ({shown}{more}); {fix}, '
                                 'or pass --allow-stale to assemble it anyway')
    require_symbols(framework, ['_ChromeMain', '_MerlinEngineGetAPI'])
    require_symbols(executable, ['_MerlinShellGetAPI'])
    if not (shell_app / 'Contents/Resources/main.jsbundle').is_file():
        raise ValueError('React host has no packaged main.jsbundle; use a Release build or FORCE_BUNDLING=1')
    if not (shell_app / 'Contents/Frameworks/hermes.framework').is_dir():
        raise ValueError('React host has no Hermes framework')
    # Reject component builds whose dylibs live outside the app bundle.
    gn_args = engine_app.parent / 'args.gn'
    if gn_args.is_file():
        import re
        if re.search(r'^\s*is_component_build\s*=\s*true\b', gn_args.read_text(), re.M):
            raise ValueError('Assembly requires a non-component Chromium app (out/Release)')
    if check_only:
        print('Both products contain the shell ABI and required resources; no files copied.')
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.merlin-assemble-', dir=destination.parent) as temp:
        stage = Path(temp) / 'Merlin.app'
        subprocess.run(['ditto', str(engine_app), str(stage)], check=True)
        shutil.copy2(executable, stage / 'Contents/MacOS' / engine_info['CFBundleExecutable'])
        merge_directory(shell_app / 'Contents/Frameworks', stage / 'Contents/Frameworks')
        merge_directory(shell_app / 'Contents/Resources', stage / 'Contents/Resources')
        # The Dock tile plug-in that keeps the chosen app icon after Merlin quits.
        merge_directory(shell_app / 'Contents/PlugIns', stage / 'Contents/PlugIns')
        # Keep Chromium's version, identity and usage descriptions. React needs
        # its own bridge settings but never the template's application delegate.
        for key in ('NSAppTransportSecurity', 'RCTNewArchEnabled', 'NSDockTilePlugIn'):
            if key in shell_info:
                engine_info[key] = shell_info[key]
        version = lambda text: tuple(int(part) for part in text.split('.'))
        engine_info['LSMinimumSystemVersion'] = max(
            (engine_info.get('LSMinimumSystemVersion', '14.0'),
             shell_info.get('LSMinimumSystemVersion', '14.0')), key=version)
        for key in ('NSMainStoryboardFile', 'NSMainNibFile'):
            engine_info.pop(key, None)
        with (stage / 'Contents/Info.plist').open('wb') as stream:
            plistlib.dump(engine_info, stream)
        shutil.rmtree(stage / 'Contents/_CodeSignature', ignore_errors=True)
        (stage / 'Contents/Resources/merlin-shell-build.json').write_text(json.dumps({
            'architecture': 'react-native-macos', 'abi': 1,
            'engineApp': str(engine_app), 'shellApp': str(shell_app),
        }, indent=2) + '\n')
        stage.rename(destination)
    print(f'Assembled {destination}; ad-hoc sign with scripts/package_mac.sh before installation.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine-app', type=Path, required=True)
    parser.add_argument('--shell-app', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--allow-stale', action='store_true',
                        help='assemble even if sources changed after either product was built')
    args = parser.parse_args()
    try:
        assemble(args.engine_app.resolve(), args.shell_app.resolve(), args.output.resolve(), args.check_only,
                 args.allow_stale)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'assemble_react_app: {error}\n')


if __name__ == '__main__':
    main()
