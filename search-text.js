'use strict';

// Shared by the index builder and the browser. Keep editorial labels out of
// article-content searches; the original labels remain visible on each item.
(() => {
  const aliases = [['AI', '인공지능'], ['한국은행', '한은'], ['금융위원회', '금융위'], ['금융감독원', '금감원']];
  const content = item => [item.title || '', item.publisher || '', item.summary || ''].join('\n');
  // Pagefind otherwise keeps middle-dot institution lists as a single token.
  // Only the index text changes; original titles and summaries stay untouched.
  const indexContent = item => content(item).replace(/[·ㆍ•‧]/gu, ' ');
  const aliasText = text => aliases.filter(group => group.some(term => term === 'AI' ? /\bai\b/i.test(text) : text.includes(term))).flat().join(' ');
  function terms(query) {
    const requested = [...query.matchAll(/"([^"]+)"|([^\s"]+)/gu)].map(match => match[1] || match[2]);
    return [...new Set(requested.flatMap(term => aliases.find(group => group.some(alias => alias.toLowerCase() === term.toLowerCase())) || [term]))].filter(Boolean).sort((a, b) => b.length - a.length);
  }
  function pieces(text, query) {
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
    if (text.length <= limit) return text;
    const parts = pieces(text, query);
    let first = 0;
    for (const part of parts) { if (part.match) break; first += part.text.length; }
    if (first === text.length) first = 0;
    const start = Math.max(0, first - 70);
    return `${start ? '…' : ''}${text.slice(start, start + limit)}${start + limit < text.length ? '…' : ''}`;
  }
  const api = { aliases, content, indexContent, aliasText, terms, pieces, hasMatch, excerpt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.SearchText = api;
})();
