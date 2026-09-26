'use strict';

const $ = selector => document.querySelector(selector);
const siteRoot = new URL('./', document.baseURI);
const labels = { morning: '조간스크랩', evening: '석간스크랩', ai: 'AI 뉴스' };
const subtitles = { morning: 'MORNING PRESS', evening: 'EVENING PRESS', ai: 'AI NEWS' };
const descriptions = { morning: '조간스크랩에서 선정한 기사를 원래 순서대로 확인합니다.', evening: '별도 기준으로 정리한 석간스크랩입니다.', ai: '수신한 AI 뉴스의 분류와 요약을 그대로 이어서 읽습니다.' };
let catalog;
let routeToken = 0;
let searchToken = 0;
let searchTimer;
let pagefindPromise;
let searchResults = [];
let shownResults = 0;
const editions = new Map();
let state = readRoute();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function readRoute() {
  const params = new URLSearchParams(location.search);
  const edition = params.get('edition') || '';
  const view = edition ? 'archive' : (['latest', 'archive', 'search'].includes(params.get('view')) ? params.get('view') : params.has('q') ? 'search' : 'latest');
  return { view, edition, query: params.get('q') || '', channel: ['morning', 'evening', 'ai'].includes(params.get('channel')) ? params.get('channel') : 'all', date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : 'all', sort: params.get('sort') === 'latest' ? 'latest' : 'relevance' };
}
function routeUrl(next, hash = '') {
  const url = new URL(siteRoot);
  if (next.edition && next.view === 'archive') url.searchParams.set('edition', next.edition);
  else if (next.view !== 'latest') url.searchParams.set('view', next.view);
  if (next.view === 'search' && next.query) url.searchParams.set('q', next.query);
  if (next.view !== 'latest' && next.channel !== 'all') url.searchParams.set('channel', next.channel);
  if (next.view !== 'latest' && next.date !== 'all') url.searchParams.set('date', next.date);
  if (next.view === 'search' && next.sort === 'latest') url.searchParams.set('sort', 'latest');
  url.hash = hash;
  return url;
}
function navigate(changes, { replace = false, hash = '', scroll = false } = {}) {
  clearTimeout(searchTimer);
  state = { ...state, ...changes };
  history[replace ? 'replaceState' : 'pushState'](null, '', routeUrl(state, hash));
  renderRoute();
  if (scroll) $('#briefing').scrollIntoView({ block: 'start' });
}
function openEdition(id, hash = '') { navigate({ view: 'archive', edition: id, channel: 'all', date: 'all' }, { hash, scroll: !hash }); }
function linkUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function externalLink(item, label = '원문 보기 ↗') {
  const href = linkUrl(item.url);
  if (!href) return element('span', 'link-note', '원문 링크 없음');
  const link = element('a', `source-link${item.linkStatus === 'unavailable' ? ' unavailable' : ''}`, item.linkStatus === 'unavailable' ? '원문 링크 확인 필요 ↗' : label);
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${item.title} — 원문 보기 (새 탭)`);
  return link;
}
function dateLabel(value, weekday = false) {
  const date = new Date(`${value}T12:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value || '날짜 미상';
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', ...(weekday ? { weekday: 'short' } : {}), timeZone: 'Asia/Seoul' }).format(date);
}
function articleTime(value) {
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return `${value.replace('T', ' ').slice(0, 16)} 발행 · 시간대 미표기`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)} 발행 · KST`;
}
function setOptions(select, values, selected) {
  select.replaceChildren(...values.map(([value, text]) => { const option = element('option', '', text); option.value = value; return option; }));
  select.value = values.some(([value]) => value === selected) ? selected : values[0]?.[0] || '';
}
function fillFilters() {
  const channels = [['all', '전체 채널'], ...catalog.channels.map(channel => [channel.id, channel.label || labels[channel.id]])];
  const channelEditions = catalog.editions.filter(edition => state.channel === 'all' || edition.channel === state.channel);
  const dates = [['all', '전체 날짜'], ...[...new Set(channelEditions.map(edition => edition.date))].sort().reverse().map(date => [date, dateLabel(date)])];
  if (state.date !== 'all' && !dates.some(([value]) => value === state.date)) {
    state.date = 'all';
    history.replaceState(null, '', routeUrl(state, location.hash));
  }
  for (const prefix of ['archive', 'search']) {
    setOptions($(`#${prefix}-channel`), channels, state.channel);
    setOptions($(`#${prefix}-date`), dates, state.date);
  }
  $('#news-search').value = state.query;
  $('#clear-search').hidden = !state.query;
  $('#search-sort').value = state.sort;
}
function editionVariant(edition) {
  const plainTitle = `${edition.date} ${labels[edition.channel] || edition.channel}`;
  return edition.title && edition.title !== plainTitle ? edition.title : '';
}
function editionChoice(edition) {
  return `${dateLabel(edition.date)} · ${labels[edition.channel] || edition.channel}${editionVariant(edition) ? ` · ${editionVariant(edition)}` : ''} (${edition.itemCount}건)`;
}
function renderOverview() {
  const latest = catalog.editions.map(edition => edition.date).sort().at(-1);
  const oldest = catalog.editions.map(edition => edition.date).sort()[0];
  $('#latest-date').textContent = latest ? latest.replaceAll('-', '.') : '자료 준비 중';
  $('#edition-total').textContent = catalog.editions.length;
  $('#item-total').textContent = catalog.editions.reduce((sum, edition) => sum + edition.itemCount, 0);
  $('#channel-total').textContent = catalog.channels.filter(channel => channel.status === 'available' && channel.latestEditionId).length;
  $('#coverage-label').textContent = latest ? `공개 자료 범위 ${oldest.replaceAll('-', '.')} — ${latest.replaceAll('-', '.')} · 일부 날짜` : '공개 자료를 준비하고 있습니다.';
  $('#channel-overview').replaceChildren(...catalog.channels.map(channel => {
    const edition = catalog.editions.find(edition => edition.id === channel.latestEditionId);
    const card = element('article', `channel-card${edition ? '' : ' channel-pending'}`);
    const top = element('div', 'channel-card-top'); top.append(element('span', 'eyebrow', subtitles[channel.id] || channel.id), element('span', 'channel-status', edition ? '최신 등록본' : '연결 준비'));
    card.append(top, element('h2', '', channel.label || labels[channel.id]));
    if (edition) {
      const button = element('button', 'channel-open', `${dateLabel(edition.date)} · ${edition.itemCount}건`);
      button.type = 'button'; button.append(element('span', '', '→')); button.addEventListener('click', () => openEdition(edition.id));
      card.append(button);
      if (editionVariant(edition)) card.append(element('p', 'channel-caption', editionVariant(edition)));
    } else card.append(element('p', 'channel-empty', '자료 연결 준비 중'), element('p', 'channel-caption', '별도로 정리된 석간 자료가 연결되면 표시됩니다.'));
    return card;
  }));
}
async function fetchEdition(record) {
  if (!editions.has(record.id)) {
    const path = new URL(record.path, siteRoot);
    if (path.origin !== siteRoot.origin || !path.pathname.startsWith(siteRoot.pathname + 'data/editions/')) throw new Error('Invalid edition path');
    const promise = fetch(path).then(async response => {
      if (!response.ok) throw new Error('Edition unavailable');
      const data = await response.json();
      if (data.id !== record.id || !Array.isArray(data.items)) throw new Error('Invalid edition');
      return data;
    }).catch(error => { editions.delete(record.id); throw error; });
    editions.set(record.id, promise);
  }
  return editions.get(record.id);
}
function articleCard(item, edition, index) {
  const card = element('article', item.summary ? 'ai-card' : 'ai-card title-card'); card.id = item.id; card.tabIndex = -1;
  const top = element('div', 'ai-card-top');
  top.append(element('span', 'article-number', String(item.rank || index + 1).padStart(2, '0')), element('span', 'publisher', item.publisher || '출처 미상'));
  if (item.category) top.prepend(element('span', 'topic-label', item.category));
  card.append(top, element('h3', '', item.title));
  if (item.summary) {
    const teaser = element('p', 'ai-teaser', item.summary);
    const details = element('details', 'article-details');
    const summary = element('summary', '', '요약 전체 보기');
    summary.setAttribute('aria-label', `${item.title} 요약 펼치기 또는 접기`);
    details.append(summary, element('p', 'full-summary', item.summary));
    details.addEventListener('toggle', () => { card.classList.toggle('expanded', details.open); summary.textContent = details.open ? '요약 접기' : '요약 전체 보기'; });
    card.append(teaser, details);
  }
  const footer = element('div', 'ai-card-footer');
  if (item.publishedAt) { const time = element('time', 'published-time', articleTime(item.publishedAt)); time.dateTime = item.publishedAt; footer.append(time); }
  else footer.append(element('span', 'published-time', '기사 발행 시각 미제공'));
  footer.append(externalLink(item)); card.append(footer);
  if (item.linkStatus === 'unavailable') card.append(element('p', 'link-note', item.linkNote || '보관된 원문 링크가 현재 열리지 않습니다.'));
  const permalink = element('a', 'entry-permalink', '이 항목 링크'); permalink.href = routeUrl({ ...state, view: 'archive', edition: edition.id, channel: 'all', date: 'all' }, item.id); permalink.setAttribute('aria-label', `${item.title} — 이 항목 링크`);
  permalink.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openEdition(edition.id, item.id); });
  card.append(permalink);
  return card;
}
function renderEdition(edition) {
  const section = element('section', 'news-section'); section.dataset.edition = edition.id;
  const heading = element('div', 'section-heading');
  const titleBlock = element('div');
  titleBlock.append(element('p', 'eyebrow section-eyebrow', subtitles[edition.channel] || edition.channel));
  const h2 = element('h2', '', labels[edition.channel] || edition.title); h2.append(element('span', 'count-badge', edition.items.length));
  titleBlock.append(h2, element('p', 'edition-heading-date', `${dateLabel(edition.date, true)} 정리본`), element('p', 'section-description', descriptions[edition.channel] || edition.title));
  if (editionVariant(edition)) titleBlock.append(element('p', 'edition-variant', editionVariant(edition)));
  heading.append(titleBlock);
  if (edition.items.some(item => item.summary)) {
    const toggle = element('button', 'text-button expand-button', '요약 모두 펼치기 ＋'); toggle.type = 'button';
    toggle.addEventListener('click', () => { const details = [...section.querySelectorAll('details')]; const open = !details.every(item => item.open); details.forEach(item => { item.open = open; }); });
    section.addEventListener('toggle', () => { const details = [...section.querySelectorAll('details')]; toggle.textContent = details.every(item => item.open) ? '요약 모두 접기 −' : '요약 모두 펼치기 ＋'; }, true);
    heading.append(toggle);
  }
  const grid = element('div', 'ai-grid'); grid.append(...edition.items.map((item, index) => articleCard(item, edition, index)));
  section.append(heading, grid); return section;
}
function showEmpty(title, description) { $('#empty-title').textContent = title; $('#empty-description').textContent = description; $('#empty-results').hidden = false; }
function jumpToHash() {
  if (!location.hash) return;
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  if (target) { target.scrollIntoView({ block: 'center' }); target.focus({ preventScroll: true }); }
}
async function renderRoute() {
  if (!catalog) return;
  const token = ++routeToken; ++searchToken;
  $('.hero').hidden = state.view === 'search';
  $('#channel-overview').hidden = state.view === 'search';
  $('#load-error').hidden = true; $('#empty-results').hidden = true; $('#load-more').hidden = true;
  $('#edition-content').replaceChildren(); $('#search-results').replaceChildren();
  $('#archive-controls').hidden = state.view !== 'archive'; $('#search-controls').hidden = state.view !== 'search'; $('#search-results').hidden = state.view !== 'search';
  document.querySelectorAll('[data-view]').forEach(node => { if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', String(node.dataset.view === state.view)); else { node.classList.toggle('active', node.dataset.view === state.view); if (node.dataset.view === state.view) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); } });
  const viewLabels = { latest: '최신 브리핑', archive: '지난 자료', search: '전체 검색' };
  document.title = `${viewLabels[state.view]} · Payment Hub`;
  $('#view-hint').textContent = { latest: '채널마다 가장 최근에 등록된 정리본입니다.', archive: '채널의 선정 순서대로 지난 자료를 읽습니다.', search: '공개 아카이브 전체에서 필요한 소식을 찾습니다.' }[state.view];
  fillFilters();
  if (state.view === 'search') { runSearch(); return; }
  const sorted = [...catalog.editions].sort((a, b) => b.date.localeCompare(a.date) || a.channel.localeCompare(b.channel));
  let records;
  if (state.view === 'archive') {
    const filtered = sorted.filter(edition => (state.channel === 'all' || edition.channel === state.channel) && (state.date === 'all' || edition.date === state.date));
    setOptions($('#archive-edition'), filtered.map(edition => [edition.id, editionChoice(edition)]), state.edition);
    $('#archive-edition').disabled = !filtered.length;
    if (state.edition && !filtered.some(edition => edition.id === state.edition)) { $('#results-status').textContent = '정리본을 찾을 수 없습니다.'; showEmpty('선택한 정리본을 찾을 수 없습니다', '채널이나 날짜를 바꾸어 다른 자료를 선택해 주세요.'); return; }
    records = filtered.length ? [filtered.find(edition => edition.id === state.edition) || filtered[0]] : [];
  } else records = catalog.channels.map(channel => catalog.editions.find(edition => edition.id === channel.latestEditionId)).filter(Boolean);
  if (!records.length) { $('#results-status').textContent = '조건에 맞는 정리본이 없습니다.'; showEmpty('등록된 정리본이 없습니다', '다른 채널이나 날짜를 선택해 주세요. 자료 연결 여부는 위의 채널 안내에서 확인할 수 있습니다.'); return; }
  $('#results-status').textContent = '정리본을 불러오고 있습니다.';
  try {
    const data = await Promise.all(records.map(fetchEdition));
    if (token !== routeToken) return;
    $('#edition-content').replaceChildren(...data.map(renderEdition));
    $('#results-status').textContent = `${data.length}개 정리본 · ${data.reduce((sum, edition) => sum + edition.items.length, 0)}개 기사 항목${state.view === 'latest' ? ' · 채널별 기준일을 확인해 주세요.' : ' · 같은 기사가 다른 정리본에도 포함될 수 있습니다.'}`;
    requestAnimationFrame(jumpToHash);
  } catch { if (token === routeToken) { $('#results-status').textContent = '자료를 불러오지 못했습니다.'; $('#error-description').textContent = '선택한 정리본을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'; $('#load-error').hidden = false; } }
}
async function getPagefind() {
  if (!pagefindPromise) pagefindPromise = import(new URL('./pagefind/pagefind.js', siteRoot).href).then(async pagefind => { await pagefind.options({ baseUrl: siteRoot.pathname }); return pagefind; }).catch(error => { pagefindPromise = null; throw error; });
  return pagefindPromise;
}
function searchCard(data) {
  const meta = data.meta || {};
  const card = element('article', 'search-result');
  const topline = element('div', 'search-result-meta');
  const publisher = element('span', 'publisher'); appendHighlighted(publisher, meta.publisher || '출처 미상');
  topline.append(element('span', 'topic-label', meta.channelLabel || labels[meta.channel] || '뉴스'), element('span', '', `${dateLabel(meta.date)} 정리본`), publisher);
  const title = element('h2'); const link = element('a');
  appendHighlighted(link, meta.title || '제목 없음');
  const targetUrl = routeUrl({ ...state, view: 'archive', edition: meta.editionId, channel: 'all', date: 'all' }, meta.entryId || '');
  link.href = targetUrl;
  link.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openEdition(meta.editionId, meta.entryId); });
  title.append(link); card.append(topline, title);
  if (state.query.trim()) {
    const matches = [['title', '제목'], ['summary', '요약'], ['publisher', '언론사']].filter(([field]) => SearchText.hasMatch(meta[field] || '', state.query));
    if (matches.length) card.append(element('p', 'match-location', `${matches.map(([, label]) => label).join('·')}에서 일치`));
  }
  const edition = catalog.editions.find(edition => edition.id === meta.editionId);
  if (edition && editionVariant(edition)) card.append(element('p', 'edition-variant', editionVariant(edition)));
  if (meta.summary) {
    const snippet = element('p', 'search-result-summary');
    appendHighlighted(snippet, SearchText.excerpt(meta.summary, state.query)); card.append(snippet);
  }
  else card.append(element('p', 'search-result-summary title-only-note', '제목과 출처를 제공하는 기사입니다. 내용은 원문에서 확인해 주세요.'));
  if (Number(meta.appearanceCount) > 1) card.append(element('p', 'repeat-note', `이 기사는 전체 자료에서 ${Number(meta.appearanceCount)}회 게재되었습니다. 발행본별로 표시합니다.`));
  const footer = element('div', 'search-result-footer'); footer.append(element('span', '', meta.category || '원래 정리본에서 보기'), externalLink({ title: meta.title, url: meta.url, linkStatus: meta.linkStatus })); card.append(footer);
  return card;
}
function appendHighlighted(node, text) {
  for (const part of SearchText.pieces(text, state.query)) node.append(part.match ? element('mark', '', part.text) : document.createTextNode(part.text));
}
async function appendSearchResults(token) {
  const start = shownResults;
  $('#load-more').disabled = true;
  try {
    const data = await Promise.all(searchResults.slice(start, start + 20).map(result => result.data()));
    if (token !== searchToken || state.view !== 'search') return;
    $('#search-results').append(...data.map(searchCard)); shownResults += data.length;
    $('#load-more').hidden = shownResults >= searchResults.length;
    $('#load-more').textContent = `결과 더 보기 (${shownResults}/${searchResults.length})`;
  } finally { if (token === searchToken) $('#load-more').disabled = false; }
}
async function runSearch() {
  const token = ++searchToken;
  $('#load-error').hidden = true; $('#empty-results').hidden = true; $('#load-more').hidden = true;
  $('#search-results').replaceChildren(); shownResults = 0;
  $('#results-status').textContent = '전체 자료를 검색하고 있습니다.';
  try {
    const pagefind = await getPagefind();
    const filters = {};
    if (state.channel !== 'all') filters.channel = state.channel;
    if (state.date !== 'all') filters.date = state.date;
    const options = { filters };
    if (state.sort === 'latest' || !state.query.trim()) options.sort = { date: 'desc' };
    const search = await pagefind.search(state.query.trim() || null, options);
    if (token !== searchToken || state.view !== 'search') return;
    searchResults = search.results;
    const queryTerms = SearchText.terms(state.query);
    $('#results-status').textContent = `${state.query.trim() ? `“${state.query.trim()}” 검색 결과 · ` : ''}${searchResults.length}개 게재 항목 · 같은 기사 반복 게재 포함`;
    if (!searchResults.length) { showEmpty('일치하는 기사가 없습니다', queryTerms.length > 1 ? '입력한 검색어를 모두 포함하는 제목·요약·언론사를 찾지 못했습니다. 검색어를 하나씩 검색하거나 날짜·채널 조건을 바꿔 보세요.' : '다른 검색어를 입력하거나 날짜·채널 조건을 바꿔 보세요.'); return; }
    await appendSearchResults(token);
  } catch { if (token === searchToken) { $('#results-status').textContent = '검색을 불러오지 못했습니다.'; $('#error-description').textContent = '검색 파일을 불러오지 못했습니다. 다시 시도하거나 지난 자료에서 정리본을 선택해 주세요.'; $('#load-error').hidden = false; } }
}
async function load() {
  $('#load-error').hidden = true;
  try {
    const response = await fetch(new URL('./data/catalog.json', siteRoot));
    if (!response.ok) throw new Error('Catalog unavailable');
    const data = await response.json();
    if (!Array.isArray(data.channels) || !Array.isArray(data.editions)) throw new Error('Invalid catalog');
    catalog = data;
    const legacyEdition = /^(morning|evening|ai)-(\d{4}-\d{2}-\d{2})$/.exec(state.edition);
    if (legacyEdition && !catalog.editions.some(edition => edition.id === state.edition)) {
      const record = catalog.editions.find(edition => edition.channel === legacyEdition[1] && edition.date === legacyEdition[2]);
      if (record) { state = { ...state, edition: record.id }; history.replaceState(null, '', routeUrl(state, location.hash)); }
    }
    const legacy = /^#(morning|ai)-(\d+)$/.exec(location.hash);
    if (legacy) {
      const record = catalog.editions.find(edition => edition.channel === legacy[1] && edition.date === '2026-09-22' && (!state.edition || edition.id === state.edition));
      if (record) { const edition = await fetchEdition(record); const entry = edition.items[Number(legacy[2]) - 1]; if (entry) { state = { ...state, view: 'archive', edition: record.id, channel: 'all', date: 'all' }; history.replaceState(null, '', routeUrl(state, entry.id)); } }
    }
    renderOverview(); await renderRoute();
  } catch { $('#results-status').textContent = '자료를 불러오지 못했습니다.'; $('#error-description').textContent = '공개 자료 목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'; $('#load-error').hidden = false; }
}

for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', event => { event.preventDefault(); navigate({ view: node.dataset.view, edition: '', channel: 'all', date: 'all', query: '', sort: 'relevance' }, { scroll: node.tagName === 'A' }); });
for (const field of ['channel', 'date']) $('#archive-' + field).addEventListener('change', event => navigate({ [field]: event.target.value, edition: '' }));
$('#archive-edition').addEventListener('change', event => navigate({ edition: event.target.value }));
$('#search-form').addEventListener('submit', event => { event.preventDefault(); navigate({ query: $('#news-search').value }, { replace: true }); });
$('#news-search').addEventListener('input', event => { const query = event.target.value; $('#clear-search').hidden = !query; clearTimeout(searchTimer); ++searchToken; $('#load-more').hidden = true; searchTimer = setTimeout(() => navigate({ query }, { replace: true }), 280); });
for (const field of ['channel', 'date', 'sort']) $('#search-' + field).addEventListener('change', event => navigate({ [field]: event.target.value, query: $('#news-search').value }, { replace: true }));
$('#clear-search').addEventListener('click', () => { navigate({ query: '' }, { replace: true }); $('#news-search').focus(); });
$('#reset-search').addEventListener('click', () => navigate({ query: '', channel: 'all', date: 'all', sort: 'relevance' }, { replace: true }));
$('#retry-load').addEventListener('click', () => catalog ? renderRoute() : load());
$('#load-more').addEventListener('click', () => {
  const token = searchToken;
  appendSearchResults(token).catch(() => {
    if (token === searchToken && state.view === 'search') $('#results-status').textContent = '추가 결과를 불러오지 못했습니다. 다시 시도해 주세요.';
  });
});
$('#back-to-top').addEventListener('click', event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); });
window.addEventListener('popstate', () => { clearTimeout(searchTimer); state = readRoute(); renderRoute(); });
load();
