// Converts audited, pinned upstream source into Brave's Resource format.
// Only run at build preparation; never import downloaded JS in the browser.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [uboPath, bravePath, output] = process.argv.slice(2);
if (!output) throw new Error('usage: node build_adblock_resources.mjs <uBlock> <Brave resources> <output>');
const { builtinScriptlets } = await import(pathToFileURL(path.join(uboPath, 'src/js/resources/scriptlets.js')));
const { default: redirects } = await import(pathToFileURL(path.join(uboPath, 'src/js/redirect-resources.js')));
const resources = [];
for (const details of builtinScriptlets) {
  const world = details.world ?? 'MAIN';
  if (!['MAIN', 'ISOLATED'].includes(world)) throw new Error(`unknown world: ${world}`);
  resources.push({
    name: details.name,
    aliases: details.aliases ?? [],
    kind: { mime: details.name.endsWith('.fn') ? 'fn/javascript' : 'application/javascript' },
    content: Buffer.from(details.fn.toString()).toString('base64'),
    dependencies: details.dependencies ?? [],
    permission: details.requiresTrust ? 1 : 0,
    world,
  });
}
const mimes = { empty: 'text/plain', js: 'application/javascript', json: 'application/json', css: 'text/css', html: 'text/html', txt: 'text/plain', gif: 'image/gif', png: 'image/png', mp3: 'audio/mp3', mp4: 'video/mp4', xml: 'text/xml' };
for (const [name, details] of redirects) {
  if (details.params) continue; // Explicit engine limitation, audited separately.
  const mime = mimes[name.split('.').at(-1)];
  if (!mime) throw new Error(`unknown replacement MIME: ${name}`);
  const file = path.join(uboPath, 'src/web_accessible_resources', name);
  resources.push({ name, aliases: Array.isArray(details.alias) ? details.alias : details.alias ? [details.alias] : [], kind: { mime }, content: fs.readFileSync(file).toString('base64'), permission: details.requiresTrust ? 1 : 0, world: 'MAIN' });
}
for (const details of JSON.parse(fs.readFileSync(path.join(bravePath, 'metadata.json')))) {
  resources.push({ name: details.name, aliases: details.aliases ?? [], kind: details.kind, dependencies: details.dependencies ?? [], permission: details.permission ?? 2, world: details.world ?? 'MAIN', content: fs.readFileSync(path.join(bravePath, 'resources', details.resourcePath)).toString('base64') });
}
// No silent overwrites when upstream names collide.
const names = new Set();
for (const r of resources) {
  for (const name of [r.name, ...r.aliases]) {
    if (names.has(name)) throw new Error(`duplicate resource: ${name}`);
    names.add(name);
  }
}
fs.writeFileSync(output, JSON.stringify(resources));
console.log(`${resources.length} resources, ${names.size} names/aliases`);
