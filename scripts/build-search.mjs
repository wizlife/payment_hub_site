import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as pagefind from 'pagefind';
import searchText from '../search-text.js';

// Only the explicit public catalog is indexed. Never crawl a source repository.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async relative => JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const forbidden = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\/Users\/|data\/private\/|gmail_id|thread_id|rfc_message_id|Content-Type:|Bearer\s|Why\?|Action Plan/i;
const allowed = new Set(['id', 'articleId', 'rank', 'title', 'publisher', 'url', 'category', 'categoryBasis', 'summary', 'publishedAt', 'linkStatus', 'linkNote']);
const { aliases, aliasText } = searchText;
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
}
const staging = path.join(root, 'work/pagefind-next');
const appearances = new Map();
for (const { item } of entries) appearances.set(item.articleId, (appearances.get(item.articleId) || 0) + 1);
const target = path.join(root, 'pagefind');
const backup = path.join(root, 'work/pagefind-previous');
await fs.mkdir(path.dirname(staging), { recursive: true });
await fs.rm(staging, { recursive: true, force: true });
try {
  const created = await pagefind.createIndex({ forceLanguage: 'ko' });
  assert(!created.errors?.length && created.index, JSON.stringify(created.errors));
  const { index } = created;
  for (const { item, edition, channel } of entries) {
    const content = searchText.indexContent(item);
    const result = await index.addCustomRecord({
      url: `/?edition=${encodeURIComponent(edition.id)}#${encodeURIComponent(item.id)}`,
      content: `${content}\n${aliasText(content)}`,
      language: 'ko',
      meta: {
        title: item.title, publisher: item.publisher, summary: item.summary || '',
        channel: edition.channel, channelLabel: channel.label, date: edition.date,
        articleId: item.articleId, entryId: item.id, editionId: edition.id,
        url: item.url,
        appearanceCount: String(appearances.get(item.articleId)),
        linkStatus: item.linkStatus || '', linkNote: item.linkNote || '',
      },
      filters: { channel: [edition.channel], date: [edition.date], publisher: [item.publisher] },
      sort: { date: edition.date, rank: String(item.rank) },
    });
    assert(!result.errors?.length, JSON.stringify(result.errors));
  }
  const written = await index.writeFiles({ outputPath: staging });
  assert(!written.errors?.length, JSON.stringify(written.errors));
  // This site uses its own accessible UI; omit unused vendor UI distributions.
  for (const name of ['pagefind-component-ui.css', 'pagefind-component-ui.js', 'pagefind-modular-ui.css', 'pagefind-modular-ui.js', 'pagefind-ui.css', 'pagefind-ui.js', 'pagefind-highlight.js']) {
    await fs.rm(path.join(staging, name), { force: true });
  }
} finally {
  await pagefind.close();
}
// An indexing/validation failure leaves the last working bundle in place.
await fs.rm(backup, { recursive: true, force: true });
let hadPrevious = false;
try { await fs.rename(target, backup); hadPrevious = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await fs.rename(staging, target); } catch (error) { if (hadPrevious) await fs.rename(backup, target); throw error; }
await fs.rm(backup, { recursive: true, force: true });
const manifest = {
  schemaVersion: 1, engine: 'Pagefind', engineVersion: '1.5.2', language: 'ko',
  recordCount: entries.length, editionCount: catalog.editions.length,
  sourceDigest: hash.digest('hex'),
  fields: ['title', 'publisher', 'summary'],
  aliases,
};
await fs.writeFile(path.join(root, 'data/search-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Indexed ${manifest.recordCount} public edition entries across ${manifest.editionCount} editions (Pagefind ${manifest.engineVersion}, ko).`);
