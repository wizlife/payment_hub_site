'use strict';

// One literal matching rule shared by filtering, highlighting, and tests.
(() => {
  const fields = ['title', 'summary', 'publisher'];
  const normalize = text => String(text || '').normalize('NFC');
  const content = item => fields.map(field => normalize(item[field])).join('\n');
  function terms(query) {
    const requested = [...normalize(query).matchAll(/"([^"]+)"|([^\s"]+)/gu)].map(match => (match[1] || match[2]).trim().toLowerCase()).filter(Boolean);
    return [...new Set(requested)].sort((a, b) => b.length - a.length);
  }
  function find(records, query, { channel = 'all', date = 'all', sort = 'relevance' } = {}) {
    const words = terms(query);
    return records.filter(item => (channel === 'all' || item.channel === channel) && (date === 'all' || item.date === date))
      .map(item => {
        const texts = fields.map(field => normalize(item[field]).toLowerCase());
        return { item, matches: words.every(word => texts.some(text => text.includes(word))), titleHits: words.filter(word => texts[0].includes(word)).length };
      })
      .filter(result => result.matches)
      .sort((a, b) => (sort === 'latest' ? 0 : b.titleHits - a.titleHits) || b.item.date.localeCompare(a.item.date) || a.item.editionId.localeCompare(b.item.editionId) || a.item.rank - b.item.rank || a.item.entryId.localeCompare(b.item.entryId))
      .map(result => result.item);
  }
  function pieces(text, query) {
    text = normalize(text);
    const words = terms(query);
    if (!words.length) return [{ text, match: false }];
    const pattern = new RegExp(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
    const result = []; let offset = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > offset) result.push({ text: text.slice(offset, match.index), match: false });
      result.push({ text: match[0], match: true }); offset = match.index + match[0].length;
    }
    if (offset < text.length) result.push({ text: text.slice(offset), match: false });
    return result;
  }
  const hasMatch = (text, query) => pieces(text, query).some(part => part.match);
  function excerpt(text, query, limit = 270) {
    text = normalize(text);
    if (text.length <= limit) return text;
    const parts = pieces(text, query);
    let first = 0;
    for (const part of parts) { if (part.match) break; first += part.text.length; }
    if (first === text.length) first = 0;
    const start = Math.max(0, first - 70);
    return `${start ? '…' : ''}${text.slice(start, start + limit)}${start + limit < text.length ? '…' : ''}`;
  }
  const api = { fields, content, terms, find, pieces, hasMatch, excerpt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.SearchText = api;
})();
