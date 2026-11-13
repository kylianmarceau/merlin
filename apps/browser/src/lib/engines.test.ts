import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineFor, hostLabel, parseSiteEngines, protectedVideoSite, siteOf } from './engines';

const defaults = { protectedVideoInWebKit: true, siteEngines: {} };

test('protected video sites and their subdomains open in WebKit', () => {
  assert.equal(engineFor('https://www.netflix.com/browse', defaults), 'webkit');
  assert.equal(engineFor('https://netflix.com/', defaults), 'webkit');
  assert.equal(engineFor('https://open.spotify.com/track/1', defaults), 'webkit');
  assert.equal(engineFor('https://www.disneyplus.com/en-gb', defaults), 'webkit');
});

test('everything else stays in Chromium', () => {
  assert.equal(engineFor('https://notnetflix.com/', defaults), 'chromium');
  assert.equal(engineFor('https://netflix.com.evil.example/', defaults), 'chromium');
  assert.equal(engineFor('https://spotify.com/', defaults), 'chromium');
  assert.equal(engineFor('http://www.netflix.com/', defaults), 'chromium', 'only https counts for the built-in list');
  assert.equal(engineFor('chrome://settings', defaults), 'chromium');
  assert.equal(engineFor('about:blank', defaults), 'chromium');
  assert.equal(engineFor('', defaults), 'chromium');
});

test('the setting turns the built-in list off, and site choices win either way', () => {
  assert.equal(engineFor('https://www.netflix.com/', { ...defaults, protectedVideoInWebKit: false }), 'chromium');
  assert.equal(engineFor('https://www.netflix.com/', { ...defaults, siteEngines: { 'https://www.netflix.com': 'chromium' } }), 'chromium');
  assert.equal(engineFor('https://example.com/a', { protectedVideoInWebKit: false, siteEngines: { 'https://example.com': 'webkit' } }), 'webkit');
});

test('sites are lowercased origins without credentials', () => {
  assert.equal(siteOf('HTTPS://User:pw@WWW.Netflix.com:443/x?y#z'), 'https://www.netflix.com:443');
  assert.equal(siteOf('ftp://example.com'), null);
  assert.equal(protectedVideoSite('https://www.netflix.com:443/'), true);
  assert.equal(hostLabel('https://www.netflix.com/browse'), 'netflix.com');
});

test('saved site choices are checked', () => {
  assert.deepEqual(parseSiteEngines('{"https://a.com":"webkit","https://b.com":"gecko","nope":"webkit","https://c.com/x":"chromium"}'),
    { 'https://a.com': 'webkit' });
  assert.deepEqual(parseSiteEngines('[1]'), {});
  assert.deepEqual(parseSiteEngines('not json'), {});
  assert.deepEqual(parseSiteEngines(null), {});
});
