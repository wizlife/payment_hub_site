import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import searchText from '../search-text.js';

// Only the explicit public catalog is indexed. Never crawl a source repository.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async relative => JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const forbidden = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\/Users\/|data\/private\/|gmail_id|thread_id|rfc_message_id|Content-Type:|Bearer\s|Why\?|Action Plan/i;
const allowed = new Set(['id', 'articleId', 'rank', 'title', 'publisher', 'url', 'category', 'categoryBasis', 'summary', 'publishedAt', 'linkStatus', 'linkNote']);
function validateItem(item) {
  assert(Object.keys(item).every(key => allowed.has(key)), 'Unexpected public article field');
  for (const key of ['id', 'articleId', 'title', 'publisher', 'url']) assert(typeof item[key] === 'string' && item[key].trim(), `Missing ${key}`);
  assert(/^[a-zA-Z0-9_-]+$/.test(item.id), 'Invalid entry ID');
  assert(Number.isInteger(item.rank) && item.rank > 0, 'Invalid source order');
  const url = new URL(item.url);
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Unsafe public URL');
  assert(!forbidden.test(JSON.stringify(item)), 'Nonpublic data detected');
}
const catalog = await read('data/catalog.json');
assert(catalog.schemaVersion === 1 && catalog.editions.length, 'No valid public editions');
const entries = [];
const editionIds = new Set();
const ids = new Set();
const hash = crypto.createHash('sha256').update(JSON.stringify(catalog));
for (const ref of catalog.editions) {
  assert(!editionIds.has(ref.id), 'Duplicate edition'); editionIds.add(ref.id);
  assert(/^[a-z0-9-]+$/.test(ref.id) && ref.path === `data/editions/${ref.id}.json`, 'Unexpected edition path');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(ref.date), 'Invalid briefing date');
  const edition = await read(ref.path);
  assert(edition.schemaVersion === 1 && edition.id === ref.id && edition.channel === ref.channel && edition.date === ref.date, 'Edition does not match catalog');
  assert(edition.items.length === ref.itemCount, 'Edition count mismatch');
  const channel = catalog.channels.find(channel => channel.id === edition.channel);
  assert(channel, 'Unknown channel');
  hash.update(JSON.stringify(edition));
  for (const item of edition.items) {
    validateItem(item);
    assert(!ids.has(item.id), 'Duplicate entry ID'); ids.add(item.id);
    entries.push({ item, edition, channel });
  }
}
for (const channel of catalog.channels) {
  const refs = catalog.editions.filter(ref => ref.channel === channel.id).sort((a,b) => b.date.localeCompare(a.date));
  assert(refs.length ? refs.some(ref => ref.id === channel.latestEditionId && ref.date === refs[0].date) : channel.latestEditionId === null, 'Latest edition pointer mismatch');
  const defaults = catalog.defaultEditionIds?.[channel.id];
  assert(defaults && typeof defaults === 'object', 'Missing default edition pointers');
  const dates = new Set(refs.map(ref => ref.date));
  assert(Object.keys(defaults).length === dates.size, 'Default edition date count mismatch');
  for (const date of dates) assert(refs.some(ref => ref.date === date && ref.id === defaults[date]), 'Default edition pointer mismatch');
  if (refs.length) assert(defaults[refs[0].date] === channel.latestEditionId, 'Default and latest editions disagree');
}
const appearances = new Map();
for (const { item } of entries) appearances.set(item.articleId, (appearances.get(item.articleId) || 0) + 1);
const records = entries.map(({ item, edition, channel }) => ({
  title: item.title, publisher: item.publisher, summary: item.summary || '',
  channel: edition.channel, channelLabel: channel.label, date: edition.date,
  articleId: item.articleId, entryId: item.id, editionId: edition.id, rank: item.rank,
  url: item.url, appearanceCount: appearances.get(item.articleId),
  linkStatus: item.linkStatus || '', linkNote: item.linkNote || '',
}));
const manifest = {
  schemaVersion: 1, engine: 'literal-substring', engineVersion: '1', language: 'ko',
  recordCount: entries.length, editionCount: catalog.editions.length,
  sourceDigest: hash.digest('hex'), fields: searchText.fields,
  matching: 'all query terms must occur literally within title, summary, or publisher; NFC; case-insensitive; no aliases',
};
// Validate all public input before replacing the last working search dataset.
const target = path.join(root, 'data/search-records.json');
await fs.writeFile(target + '.tmp', JSON.stringify({ schemaVersion: 1, records }) + '\n');
await fs.rename(target + '.tmp', target);
await fs.writeFile(path.join(root, 'data/search-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${records.length} public search records across ${catalog.editions.length} editions (${Buffer.byteLength(JSON.stringify(records))} bytes).`);
