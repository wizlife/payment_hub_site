const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create, sha } = require('../data-client.js');

async function fixture(overrides = {}) {
  const values = {
    'data/catalog.json': { channels: [], editions: [] },
    'data/documents.json': { items: [], coverage: [] },
    'report-institutions.json': {},
    'data/search-records.json': { records: [] },
    'data/search-manifest.json': { sourceDigest: 'a'.repeat(64), recordCount: 0, documentCount: 0, editionCount: 0 }
  };
  Object.assign(values, overrides);
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
  assert.equal(first.records, undefined);
  assert.ok(!requests.some(r => r.url.includes('search-records.json')), 'home does not request the full search file');
  await client.search(first);
  assert.equal(first.records.length, 0);
  assert.equal(requests[0].options.cache, 'no-cache');
  assert.ok(requests.slice(1).every(r => r.options.cache === 'force-cache' && r.options.signal));
  assert.ok(requests.slice(1).every(r => new URL(r.url).searchParams.get('v')?.length === 64));
  const count = requests.length;
  await client.stage(await client.manifest(), first);
  assert.equal(requests.length, count + 1, 'unchanged files stay in memory; only the release is requested');
  await assert.rejects(client.read(first, '../secret.json'), /File not in release/);
});

test('latest editions begin loading before a slow report catalog finishes', {timeout:5000}, async () => {
  const id = 'morning-2026-11-05-test', name = `data/editions/${id}.json`;
  const {files, release} = await fixture({
    'data/catalog.json': {channels:[{latestEditionId:id}],editions:[{id,path:name}]},
    'data/search-manifest.json': {sourceDigest:'a'.repeat(64),recordCount:0,documentCount:0,editionCount:1},
    [name]: {id,items:[]}
  });
  let releaseDocs, editionRequested;
  const docsBlocked = new Promise(resolve => { releaseDocs = resolve; });
  const editionStarted = new Promise(resolve => { editionRequested = resolve; });
  const client = create({base:'https://example.test/',fetcher:async url => {
    if (url.pathname === '/data/documents.json') await docsBlocked;
    if (url.pathname === '/'+name) editionRequested();
    if (url.pathname.endsWith('search-records.json')) throw Error('Home must not request search');
    return new Response(files[url.pathname.slice(1)]);
  }});
  const staged = client.stage(release);
  await editionStarted;
  releaseDocs();
  assert.equal((await staged).catalog.editions[0].id,id);
});

test('a poisoned hash URL is reloaded once and is never accepted with wrong bytes', async () => {
  const {files,release} = await fixture(), modes=[];
  const client=create({base:'https://example.test/',fetcher:async(url,options)=>{
    modes.push(options.cache);
    return new Response(options.cache==='reload' ? files[url.pathname.slice(1)] : '{"wrong":true}');
  }});
  const snapshot={manifest:release,files:new Map()};
  assert.deepEqual(await client.read(snapshot,'data/catalog.json'),{channels:[],editions:[]});
  assert.deepEqual(modes,['force-cache','reload']);
});

test('an HTTP error held in browser cache is bypassed on retry', async () => {
  const {files,release}=await fixture(),modes=[];
  const client=create({base:'https://example.test/',fetcher:async(url,options)=>{
    modes.push(options.cache);
    return options.cache==='force-cache' ? new Response('Temporary failure',{status:503}) : new Response(files[url.pathname.slice(1)]);
  }});
  const snapshot={manifest:release,files:new Map()};
  assert.deepEqual(await client.read(snapshot,'data/catalog.json'),{channels:[],editions:[]});
  assert.deepEqual(modes,['force-cache','reload']);
});

test('failed lazy search leaves the home snapshot usable and can retry', async () => {
  const {files,release}=await fixture();let fail=true;
  const client=create({base:'https://example.test/',fetcher:async url=>new Response(fail&&url.pathname.endsWith('search-records.json')?'{}':files[url.pathname.slice(1)])});
  const snapshot=await client.stage(release);
  await assert.rejects(client.search(snapshot),/mismatch/);
  assert.equal(snapshot.records,undefined);
  assert.deepEqual(snapshot.documents.items,[]);
  fail=false;
  assert.deepEqual(await client.search(snapshot),[]);
  const bad=await fixture({'data/search-records.json':{records:[{title:'Unexpected'}]}});
  const invalid=create({base:'https://example.test/',fetcher:async url=>new Response(bad.files[url.pathname.slice(1)])});
  await assert.rejects(invalid.search(await invalid.stage(bad.release)),/mismatch/);
});

test('a delayed search completion stays bound to its originating release', {timeout:5000}, async () => {
  const {files,release}=await fixture();let resume;
  const blocked=new Promise(resolve=>{resume=resolve});
  const client=create({base:'https://example.test/',fetcher:async url=>{
    if(url.pathname.endsWith('search-records.json'))await blocked;
    return new Response(files[url.pathname.slice(1)]);
  }});
  const old=await client.stage(release);
  const pending=client.search(old);
  const newer=await client.stage({...release,version:'c'.repeat(64)},old);
  resume();await pending;
  assert.equal(newer.records,undefined);
  assert.deepEqual(await client.search(newer),[]);
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
