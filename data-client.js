/* Verified public snapshots. No persistent storage of news or search results. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubData = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const core = ['data/catalog.json', 'data/documents.json', 'report-institutions.json', 'data/search-records.json', 'data/search-manifest.json'];
  const hex = /^[a-f0-9]{64}$/;
  const safePath = path => core.includes(path) || /^data\/editions\/[a-z0-9-]+\.json$/.test(path);
  async function sha(text) {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  function create({ base, fetcher = (...args) => fetch(...args), timeout = 15000 } = {}) {
    base = new URL(base);
    async function get(url, cache = 'no-cache') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetcher(url, { cache, signal: controller.signal });
        if (!response.ok) { const error = new Error('Public file unavailable'); error.status = response.status; throw error; }
        return await response.text();
      } finally { clearTimeout(timer); }
    }
    async function manifest() {
      const value = JSON.parse(await get(new URL('data/release.json', base)));
      if (value.schemaVersion !== 1 || !hex.test(value.version) || !hex.test(value.uiVersion) || !hex.test(value.sourceDigest) || !value.files) throw new Error('Invalid release');
      if (!core.every(path => hex.test(value.files[path])) || !Object.entries(value.files).every(([path, hash]) => safePath(path) && hex.test(hash))) throw new Error('Invalid release files');
      const { version, ...payload } = value;
      if (await sha(JSON.stringify(payload)) !== version) throw new Error('Invalid release digest');
      return value;
    }
    async function read(snapshot, path) {
      const expected = snapshot.manifest.files[path];
      if (!safePath(path) || !hex.test(expected)) throw new Error('File not in release');
      if (!snapshot.files.has(path)) {
        const url = new URL(path, base); url.searchParams.set('v', expected);
        const promise = (async () => {
          // A content hash identifies the bytes, even when the cached response is
          // old. A wrong response cached during deployment gets one network retry.
          for (const cache of ['force-cache', 'reload']) {
            let text;
            try { text = await get(url, cache); }
            catch (error) {
              // Browsers may reuse an HTTP error with force-cache too.
              if (cache === 'force-cache' && error.status) continue;
              throw error;
            }
            if (await sha(text) === expected) return JSON.parse(text);
          }
          throw new Error('Release file mismatch');
        })().catch(error => { snapshot.files.delete(path); throw error; });
        snapshot.files.set(path, promise);
      }
      try { return await snapshot.files.get(path); }
      catch (error) {
        // A pending request may have been shared from the previous snapshot.
        // Evict it here too, so a failed archive read can always be retried.
        snapshot.files.delete(path); throw error;
      }
    }
    async function stage(release, previous, { editionId } = {}) {
      const snapshot = { manifest: release, files: new Map() };
      if (previous) for (const [path, value] of previous.files) {
        if (previous.manifest.files[path] === release.files[path]) snapshot.files.set(path, value);
      }
      const catalogReady = read(snapshot, 'data/catalog.json').then(async catalog => {
        if (!Array.isArray(catalog.channels) || !Array.isArray(catalog.editions)) throw new Error('Invalid public snapshot');
        if (!catalog.editions.every(ref => ref.path === `data/editions/${ref.id}.json` && release.files[ref.path])) throw new Error('Edition missing from release');
        const ids = new Set(catalog.channels.map(channel => channel.latestEditionId).filter(Boolean));
        if (editionId) ids.add(editionId);
        // Do not make current articles wait for the report catalog or search file.
        await Promise.all(catalog.editions.filter(ref => ids.has(ref.id)).map(async ref => {
          const edition = await read(snapshot, ref.path);
          if (edition.id !== ref.id || !Array.isArray(edition.items)) throw new Error('Invalid edition');
        }));
        return catalog;
      });
      const [catalog, documents, registry, searchManifest] = await Promise.all([
        catalogReady, read(snapshot, 'data/documents.json'), read(snapshot, 'report-institutions.json'), read(snapshot, 'data/search-manifest.json')
      ]);
      if (!Array.isArray(documents.items) || !Array.isArray(documents.coverage)) throw new Error('Invalid public snapshot');
      if (searchManifest.sourceDigest !== release.sourceDigest || !Number.isInteger(searchManifest.recordCount) || searchManifest.recordCount < 0 || documents.items.length !== searchManifest.documentCount || catalog.editions.length !== searchManifest.editionCount) throw new Error('Search and catalog mismatch');
      Object.assign(snapshot, { catalog, documents, registry, searchManifest });
      return snapshot;
    }
    async function search(snapshot) {
      if (snapshot.records) return snapshot.records;
      const value = await read(snapshot, 'data/search-records.json');
      if (!Array.isArray(value.records) || value.records.length !== snapshot.searchManifest.recordCount) throw new Error('Search and catalog mismatch');
      // Keep results on the snapshot that requested them. A later completion must
      // never attach old records to a newly activated release.
      snapshot.records = value.records;
      return snapshot.records;
    }
    return { manifest, stage, read, search };
  }
  return { create, sha };
});
