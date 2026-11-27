import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, effectiveChannel, newestUpdate, type Release } from './updates';

const release = (tag: string, prerelease = tag.includes('-'), draft = false): Release =>
  ({ tag_name: tag, prerelease, draft });

test('versions order as semantic versions, betas before their release', () => {
  assert.ok(compareVersions('0.2.0-beta.13', '0.2.0-beta.9') > 0);
  assert.ok(compareVersions('0.2.0', '0.2.0-beta.13') > 0);
  assert.ok(compareVersions('v0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('v0.2.0-beta.4', '0.2.0-beta.4'), 0);
});

test('a channel offers only newer releases it includes', () => {
  const list = [release('v0.2.0-beta.12'), release('v0.2.0-beta.14'), release('v0.2.0-beta.15', true, true), release('v0.1.0')];
  assert.equal(newestUpdate(list, '0.2.0-beta.13', 'beta')?.version, '0.2.0-beta.14');
  assert.equal(newestUpdate(list, '0.2.0-beta.13', 'stable'), null);
  assert.equal(newestUpdate([...list, release('v0.2.0')], '0.2.0-beta.13', 'stable')?.version, '0.2.0');
  assert.equal(newestUpdate(list, '0.2.0-beta.14', 'beta'), null);
});

test('the automatic channel follows the running build', () => {
  assert.equal(effectiveChannel('auto', '0.2.0-beta.13'), 'beta');
  assert.equal(effectiveChannel('auto', '0.2.0'), 'stable');
  assert.equal(effectiveChannel('stable', '0.2.0-beta.13'), 'stable');
});

test('in-app updates require the arm64 DMG and checksum from the selected release', () => {
  const tag = 'v0.2.0';
  const url = `https://github.com/kylianmarceau/merlin/releases/download/${tag}`;
  const image = 'Merlin-0.2.0-arm64.dmg';
  const assets = [image, `${image}.sha256`].map(name => ({
    name, browser_download_url: `${url}/${name}`, state: 'uploaded',
  }));
  const find = (assets: Release['assets']) =>
    newestUpdate([{ ...release(tag), assets }], '0.1.0', 'stable');
  assert.equal(find(assets)?.installable, true);
  assert.equal(find(assets.slice(0, 1))?.installable, false);
  assert.equal(find([{ ...assets[0], state: 'new' }, assets[1]])?.installable, false);
  assert.equal(find([{ ...assets[0], browser_download_url: 'https://example.org/update.dmg' }, assets[1]])?.installable, false);
  assert.equal(find(undefined)?.url, 'https://github.com/kylianmarceau/merlin/releases/tag/v0.2.0');
});
