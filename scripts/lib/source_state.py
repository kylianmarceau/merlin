"""The source state an assembled Merlin.app was built from, and whether it matches.

Assembly records the repository's commit and a digest of any uncommitted
changes to the product sources in the app's merlin-shell-build.json. The e2e
runner compares that record with the checkout it runs from, so a test run
always says which build it tested and refuses one built from other sources.
"""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

# Everything that ends up in the engine or the React host. Tests, docs and
# scripts are not product sources: changing them needs no new build.
# The engine (Chromium with Merlin's overlay and patches) and the React host
# are built separately, so each records the state of its own sources.
ENGINE_SOURCES = ('overlay', 'patches', 'tools', 'Cargo.toml', 'Cargo.lock', 'UPSTREAM_PIN')
SHELL_SOURCES = ('apps/browser', 'packages', 'pnpm-patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')
PRODUCT_SOURCES = ENGINE_SOURCES + SHELL_SOURCES


def _git(repo: Path, *args: str) -> bytes:
    return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True).stdout


def source_state(repo: Path, sources: tuple = PRODUCT_SOURCES) -> dict:
    """{'sourceCommit': HEAD, 'sourceChanges': digest of uncommitted changes to `sources`, or None}."""
    commit = _git(repo, 'rev-parse', 'HEAD').decode().strip()
    digest = hashlib.sha256()
    changed = False
    diff = _git(repo, 'diff', 'HEAD', '--binary', '--', *sources)
    if diff:
        digest.update(diff)
        changed = True
    untracked = _git(repo, 'ls-files', '--others', '--exclude-standard', '-z', '--', *sources)
    for name in sorted(filter(None, untracked.split(b'\0'))):
        path = repo / name.decode()
        if path.is_file():
            digest.update(b'\0untracked\0' + name + b'\0' + path.read_bytes())
            changed = True
    return {'sourceCommit': commit, 'sourceChanges': digest.hexdigest() if changed else None}


def same_products(repo: Path, recorded: str, commit: str, sources: tuple = PRODUCT_SOURCES) -> bool:
    """Whether two commits have the same product sources (only tests, docs or scripts differ)."""
    result = subprocess.run(['git', '-C', str(repo), 'diff', '--quiet', recorded, commit, '--', *sources],
                            capture_output=True)
    return result.returncode == 0  # 1: they differ; 128: a commit this clone doesn't have


def mismatch(manifest: dict | None, current: dict, repo: Path | None = None) -> str | None:
    """Why an app with this manifest wasn't built from `current`, or None if it was.

    With `repo`, an app assembled at another commit still matches when the
    product sources are the same at both, so committing a test needs no new
    build.
    """
    if manifest is None:
        return 'it has no assembly manifest (merlin-shell-build.json), so it is not an assembled build of this checkout'
    if manifest.get('staleProducts'):
        return (f"it was assembled with --allow-stale from a {' and '.join(manifest['staleProducts'])} "
                'built from other sources')
    recorded = manifest.get('sourceCommit')
    if not recorded:
        return 'its assembly manifest records no source commit (assembled before builds were recorded)'
    if recorded != current['sourceCommit'] and not (repo and same_products(repo, recorded, current['sourceCommit'])):
        return (f'it was assembled from commit {recorded[:12]}, but the checkout is at {current["sourceCommit"][:12]} '
                'and their product sources differ')
    built, now = manifest.get('sourceChanges'), current['sourceChanges']
    if built != now:
        if built is None:
            return 'the checkout has uncommitted product changes that the app was assembled without'
        if now is None:
            return 'the app was assembled with uncommitted product changes that the checkout no longer has'
        return 'the checkout\'s uncommitted product changes differ from the ones the app was assembled with'
    return None


def product_mismatch(stamp: dict | None, current: dict, repo: Path, sources: tuple) -> str | None:
    """Why a product stamped with `stamp` wasn't built from `current` sources, or None if it was.

    Commits are compared by their `sources`, so a commit that changes only
    the other product, tests or docs needs no rebuild.
    """
    if not stamp or not stamp.get('sourceCommit'):
        return 'it records no source commit'
    recorded = stamp['sourceCommit']
    if recorded != current['sourceCommit'] and not same_products(repo, recorded, current['sourceCommit'], sources):
        return f'it was built from commit {recorded[:12]}, and its sources have changed since'
    if stamp.get('sourceChanges') != current['sourceChanges']:
        return ('it was built with uncommitted changes that differ from the checkout\'s'
                if stamp.get('sourceChanges') else 'the checkout has uncommitted changes it was built without')
    return None
