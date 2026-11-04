import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => fs.readFile(path.join(root, name));
const assets = ['styles.css', 'search-text.js', 'data-client.js', 'app.js', 'analytics.js'];
const assetHashes = Object.fromEntries(await Promise.all(assets.map(async name => [name, hash(await read(name))])));
let html = (await read('index.html')).toString('utf8');
for (const name of assets) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`((?:src|href)="\\./${escaped}\\?v=)[^"]+(")`, 'g');
  if (![...html.matchAll(expression)].length) throw new Error(`Missing versioned asset ${name}`);
  html = html.replace(expression, `$1${assetHashes[name]}$2`);
}
const marker = /(<meta name="hub-ui-version" content=")[^"]*(">)/;
if (!marker.test(html)) throw new Error('Missing UI version marker');
// Exclude the marker itself: identical inputs always produce identical output.
const uiVersion = hash(html.replace(marker, '$1$2'));
html = html.replace(marker, `$1${uiVersion}$2`);
const catalog = JSON.parse(await read('data/catalog.json'));
const search = JSON.parse(await read('data/search-manifest.json'));
const names = ['data/catalog.json', 'data/documents.json', 'report-institutions.json', 'data/search-records.json', 'data/search-manifest.json', ...catalog.editions.map(ref => ref.path)].sort();
if (names.some(name => !/^data\/editions\/[a-z0-9-]+\.json$/.test(name) && !['data/catalog.json','data/documents.json','report-institutions.json','data/search-records.json','data/search-manifest.json'].includes(name))) throw new Error('Unexpected release file');
const files = Object.fromEntries(await Promise.all(names.map(async name => [name, hash(await read(name))])));
const payload = { schemaVersion: 1, uiVersion, sourceDigest: search.sourceDigest, files };
const release = { ...payload, version: hash(JSON.stringify(payload)) };
for (const [name, text] of [['index.html', html], ['data/release.json', JSON.stringify(release, null, 2) + '\n']]) {
  let old; try { old = (await read(name)).toString('utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (old !== text) { await fs.writeFile(path.join(root, name + '.tmp'), text); await fs.rename(path.join(root, name + '.tmp'), path.join(root, name)); }
}
console.log(`Verified release ${release.version.slice(0,12)} (${names.length} public files).`);
