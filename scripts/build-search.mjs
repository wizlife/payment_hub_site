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
const documents = await read('data/documents.json');
assert(documents.schemaVersion === 1 && Array.isArray(documents.items), 'Invalid document catalog');
const docFields = new Set(['id','title','publisher','institution','date','type','series','issue','issueUrl','url','summary']);
const institutions = {bok:['한국은행','bok.or.kr'],kif:['한국금융연구원','kif.re.kr'],kcmi:['자본시장연구원','kcmi.re.kr'],bis:['BIS','bis.org'],fsc:['금융위원회','fsc.go.kr']};
assert(!forbidden.test(JSON.stringify(documents)), 'Nonpublic document data');
for (const doc of documents.items) {
  assert(Object.keys(doc).every(key => docFields.has(key)), 'Unexpected document field');
  assert(/^doc-[a-z]+-[a-f0-9]{16}$/.test(doc.id) && !ids.has(doc.id), 'Invalid or duplicate document ID'); ids.add(doc.id);
  const institution = institutions[doc.institution];
  assert(institution && doc.publisher === institution[0], 'Unknown document institution');
  assert(['report','periodical','policy'].includes(doc.type), 'Invalid document type');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(doc.date) && !Number.isNaN(Date.parse(doc.date)) && doc.date >= documents.window.from && doc.date <= documents.window.to, 'Document date outside collection window');
  assert(typeof doc.title === 'string' && doc.title.trim() && typeof doc.series === 'string', 'Missing document title or series');
  // Trial is bibliographic links only; summaries require a separate reuse review.
  assert(doc.summary === '', 'Trial document summaries must be empty');
  for (const field of ['url','issueUrl']) {
    if (!doc[field] && field === 'issueUrl') continue;
    const u = new URL(doc[field]);
    assert(u.protocol === 'https:' && !u.username && !u.password && (u.hostname === institution[1] || u.hostname.endsWith('.' + institution[1])), 'Document must link to its official institution');
  }
  records.push({...doc, kind:'document', articleId:doc.id, entryId:doc.id, editionId:doc.id, rank:1, channel:'document', channelLabel:'기관자료', appearanceCount:1});
}
hash.update(JSON.stringify(documents));
const manifest = {
  schemaVersion: 1, engine: 'literal-substring', engineVersion: '1', language: 'ko',
  recordCount: records.length, newsRecordCount: entries.length, documentCount: documents.items.length, editionCount: catalog.editions.length,
  sourceDigest: hash.digest('hex'), fields: searchText.fields,
  matching: 'all query terms must occur literally within title, summary, or publisher; NFC; case-insensitive; no aliases',
};
// Validate all public input before replacing the last working search dataset.
const target = path.join(root, 'data/search-records.json');
await fs.writeFile(target + '.tmp', JSON.stringify({ schemaVersion: 1, records }) + '\n');
await fs.rename(target + '.tmp', target);
await fs.writeFile(path.join(root, 'data/search-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${records.length} public search records across ${catalog.editions.length} editions (${Buffer.byteLength(JSON.stringify(records))} bytes).`);
