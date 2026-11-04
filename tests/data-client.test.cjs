const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create, sha } = require('../data-client.js');

async function fixture() {
  const values = {
    'data/catalog.json': { channels: [], editions: [] },
    'data/documents.json': { items: [], coverage: [] },
    'report-institutions.json': {},
    'data/search-records.json': { records: [] },
    'data/search-manifest.json': { sourceDigest: 'a'.repeat(64), recordCount: 0, documentCount: 0, editionCount: 0 }
  };
  const files = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, JSON.stringify(value)]));
  const payload = { schemaVersion: 1, uiVersion: 'b'.repeat(64), sourceDigest: 'a'.repeat(64), files: {} };
  for (const [name, text] of Object.entries(files)) payload.files[name] = await sha(text);
  const release = { ...payload, version: await sha(JSON.stringify(payload)) };
  files['data/release.json'] = JSON.stringify(release);
  return { files, release };
}

test('release is revalidated and files are pinned to verified content hashes', async () => {
  const { files } = await fixture(), requests = [];
  const client = create({ base: 'https://example.test/hub/', fetcher: async (url, options) => {
    requests.push({ url: String(url), options }); return new Response(files[url.pathname.replace('/hub/', '')]);
  } });
  const release = await client.manifest();
  const first = await client.stage(release);
  assert.equal(first.records.length, 0);
  assert.ok(requests.every(r => r.options.cache === 'no-cache' && r.options.signal));
  assert.ok(requests.slice(1).every(r => new URL(r.url).searchParams.get('v')?.length === 64));
  const count = requests.length;
  await client.stage(await client.manifest(), first);
  assert.equal(requests.length, count + 1, 'unchanged files stay in memory; only the release is requested');
  await assert.rejects(client.read(first, '../secret.json'), /File not in release/);
});

test('mixed deployment fails without mutating the active snapshot and can retry', async () => {
  const { files, release } = await fixture(); let corrupt = false;
  const client = create({ base: 'https://example.test/', fetcher: async url => new Response(corrupt && url.pathname.endsWith('documents.json') ? '{"items":["wrong"]}' : files[url.pathname.slice(1)]) });
  const active = await client.stage(release);
  const nextDocs = JSON.stringify({ items: [], coverage: [], revision: 2 });
  const next = { ...release, files: { ...release.files, 'data/documents.json': await sha(nextDocs) } };
  corrupt = true;
  await assert.rejects(client.stage(next, active), /mismatch/);
  assert.deepEqual(active.documents, { items: [], coverage: [] });
  corrupt = false; files['data/documents.json'] = nextDocs;
  const updated = await client.stage(next, active);
  assert.equal(updated.documents.revision, 2);
  assert.equal(active.documents.revision, undefined);
});

test('failed request is evicted, unavailable files and invalid manifests are rejected', async () => {
  const { files, release } = await fixture(); let fail = true;
  const client = create({ base: 'https://example.test/', fetcher: async url => fail ? new Response('error', { status: 503 }) : new Response(files[url.pathname.slice(1)]) });
  const snapshot = { manifest: release, files: new Map() };
  await assert.rejects(client.read(snapshot, 'data/catalog.json'), /unavailable/);
  fail = false;
  assert.deepEqual(await client.read(snapshot, 'data/catalog.json'), { channels: [], editions: [] });
  files['data/release.json'] = JSON.stringify({ ...release, version: '0'.repeat(64) });
  await assert.rejects(client.manifest(), /digest/);
});

test('committed release exactly matches public files and versioned UI references', async () => {
  const root = path.resolve(__dirname, '..');
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const release = JSON.parse(read('data/release.json'));
  const { version, ...payload } = release;
  assert.equal(version, await sha(JSON.stringify(payload)));
  for (const [name, hash] of Object.entries(release.files)) assert.equal(await sha(read(name)), hash, name);
  const html = read('index.html');
  assert.ok(html.includes(`name="hub-ui-version" content="${release.uiVersion}"`));
  for (const name of ['styles.css','search-text.js','data-client.js','app.js','analytics.js']) assert.ok(html.includes(`./${name}?v=${await sha(read(name))}`), name);
  assert.equal(release.uiVersion, await sha(html.replace(/(<meta name="hub-ui-version" content=")[^"]*(">)/, '$1$2')));
});

test('a failed request inherited from another snapshot is evicted before retry', async () => {
  const name = 'data/editions/morning-2026-11-04-test.json';
  const body = JSON.stringify({ id: 'morning-2026-11-04-test', items: [] });
  const failed = Promise.reject(new Error('Earlier snapshot request failed')); failed.catch(() => {});
  const snapshot = { manifest: { files: { [name]: await sha(body) } }, files: new Map([[name, failed]]) };
  const client = create({ base: 'https://example.test/', fetcher: async () => new Response(body) });
  await assert.rejects(client.read(snapshot, name), /Earlier/);
  assert.equal(snapshot.files.has(name), false);
  assert.equal((await client.read(snapshot, name)).id, 'morning-2026-11-04-test');
});
