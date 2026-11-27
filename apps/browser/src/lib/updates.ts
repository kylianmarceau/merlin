// Merlin's releases are GitHub Releases tagged "v0.2.0-beta.13". These
// helpers compare versions and pick the newest release a channel offers.
// Pure: no network, no browser state.

const RELEASES = 'https://github.com/kylianmarceau/merlin/releases';
type Asset = { name: string; state: string; browser_download_url: string };
export type Release = { tag_name: string; name?: string | null; prerelease: boolean; draft: boolean; assets?: Asset[] };
export type Channel = 'stable' | 'beta';
export type Update = { tag: string; version: string; url: string; name: string; installable: boolean };

type Parsed = { core: number[]; pre: (string | number)[] };

export function parseVersion(text: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(text);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.').map(part => (/^\d+$/.test(part) ? Number(part) : part)) : [] };
}

/** Semantic-version order: negative when `a` is older than `b`. */
export function compareVersions(a: string, b: string) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // A release outranks its pre-releases: 1.0.0 > 1.0.0-beta.2.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export const isPrerelease = (version: string) => !!parseVersion(version)?.pre.length;

/** "auto" is Beta while the running build is a pre-release. */
export function effectiveChannel(choice: Channel | 'auto', current: string | null): Channel {
  if (choice !== 'auto') return choice;
  return current && isPrerelease(current) ? 'beta' : 'stable';
}

/**
 * The newest release the channel offers that is newer than `current`, or
 * null. Stable ignores pre-releases; switching to it never offers an older
 * version than the one running.
 */
export function newestUpdate(releases: readonly Release[], current: string, channel: Channel): Update | null {
  let best: Release | null = null;
  for (const r of releases) {
    if (r.draft || typeof r.tag_name !== 'string' || !parseVersion(r.tag_name)) continue;
    if (channel === 'stable' && (r.prerelease || isPrerelease(r.tag_name))) continue;
    if (compareVersions(r.tag_name, current) <= 0) continue;
    if (!best || compareVersions(r.tag_name, best.tag_name) > 0) best = r;
  }
  if (!best) return null;
  const tag = best.tag_name;
  const version = tag.replace(/^v/, '');
  const image = `Merlin-${version}-arm64.dmg`;
  const assets = best.assets ?? [];
  const installable = [image, `${image}.sha256`].every(name =>
    assets.some(asset => asset.name === name && asset.state === 'uploaded' &&
      asset.browser_download_url === `${RELEASES}/download/${tag}/${name}`));
  return { tag, version, url: `${RELEASES}/tag/${tag}`, name: best.name || `Merlin ${version}`, installable };
}
