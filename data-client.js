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
    async function get(url) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetcher(url, { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw new Error('Public file unavailable');
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
        const promise = get(url).then(async text => {
          if (await sha(text) !== expected) throw new Error('Release file mismatch');
          return JSON.parse(text);
        }).catch(error => { snapshot.files.delete(path); throw error; });
        snapshot.files.set(path, promise);
      }
      try { return await snapshot.files.get(path); }
      catch (error) {
        // A pending request may have been shared from the previous snapshot.
        // Evict it here too, so a failed archive read can always be retried.
        snapshot.files.delete(path); throw error;
      }
    }
    async function stage(release, previous) {
      const snapshot = { manifest: release, files: new Map() };
      if (previous) for (const [path, value] of previous.files) {
        if (previous.manifest.files[path] === release.files[path]) snapshot.files.set(path, value);
      }
      const [catalog, documents, registry, search, searchManifest] = await Promise.all(core.map(path => read(snapshot, path)));
      if (!Array.isArray(catalog.channels) || !Array.isArray(catalog.editions) || !Array.isArray(documents.items) || !Array.isArray(documents.coverage) || !Array.isArray(search.records)) throw new Error('Invalid public snapshot');
      if (searchManifest.sourceDigest !== release.sourceDigest || search.records.length !== searchManifest.recordCount || documents.items.length !== searchManifest.documentCount || catalog.editions.length !== searchManifest.editionCount) throw new Error('Search and catalog mismatch');
      if (!catalog.editions.every(ref => ref.path === `data/editions/${ref.id}.json` && release.files[ref.path])) throw new Error('Edition missing from release');
      Object.assign(snapshot, { catalog, documents, registry, records: search.records });
      return snapshot;
    }
    return { manifest, stage, read };
  }
  return { create, sha };
});
