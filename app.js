'use strict';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const state = { data: null, section: ['all', 'morning', 'ai'].includes(params.get('section')) ? params.get('section') : 'all', query: params.get('q') || '', category: '전체', expanded: new Set() };
let visibleAi = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsupported article URL');
  return url.href;
}
function externalLink(article, className, label) {
  const link = element('a', className, label);
  link.href = safeUrl(article.url);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${article.title} — ${label || '원문 보기'} (새 탭)`);
  return link;
}
function syncUrl() {
  const url = new URL(location.href);
  if (state.query) url.searchParams.set('q', state.query); else url.searchParams.delete('q');
  if (state.section !== 'all') url.searchParams.set('section', state.section); else url.searchParams.delete('section');
  history.replaceState(null, '', url);
}
function resetFilters() {
  state.query = ''; state.section = 'all'; state.category = '전체';
  $('#news-search').value = '';
  render();
}
function matches(article) {
  const terms = state.query.normalize('NFKC').toLocaleLowerCase('ko').trim().split(/\s+/).filter(Boolean);
  const haystack = [article.title, article.publisher, article.category, article.summary || ''].join(' ').normalize('NFKC').toLocaleLowerCase('ko');
  return terms.every(term => haystack.includes(term));
}
function morningItem(article, index) {
  const item = element('article', 'morning-item');
  item.id = article.id;
  const link = externalLink(article, 'morning-link');
  link.append(element('span', 'article-number', String(index + 1).padStart(2, '0')));
  const content = element('div', 'morning-content');
  const meta = element('div', 'article-meta');
  meta.append(element('span', 'publisher', article.publisher), element('span', 'meta-divider'), element('span', '', article.category));
  content.append(meta, element('h3', '', article.title));
  const arrow = element('span', 'external-arrow', '↗'); arrow.setAttribute('aria-hidden', 'true');
  link.append(content, arrow); item.append(link); return item;
}
function publishedLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}
function updateExpandLabel() {
  const allOpen = visibleAi.length > 0 && visibleAi.every(article => state.expanded.has(article.id));
  $('#expand-all').replaceChildren(document.createTextNode(allOpen ? '요약 모두 접기 ' : '요약 모두 펼치기 '), element('span', '', allOpen ? '−' : '＋'));
}
function aiItem(article) {
  const card = element('article', 'ai-card'); card.id = article.id; card.tabIndex = -1;
  const top = element('div', 'ai-card-top');
  top.append(element('span', 'topic-label', article.category), element('span', 'publisher', article.publisher));
  const title = element('h3', '', article.title);
  const teaser = element('p', 'ai-teaser', article.summary);
  const details = element('details', 'article-details');
  details.dataset.articleId = article.id;
  const summary = element('summary', '', '요약 전체 보기');
  summary.setAttribute('aria-label', `${article.title} 요약 펼치기 또는 접기`);
  details.append(summary, element('p', 'full-summary', article.summary));
  details.open = state.expanded.has(article.id);
  card.classList.toggle('expanded', details.open);
  if (details.open) summary.textContent = '요약 접기';
  details.addEventListener('toggle', () => {
    if (details.open) state.expanded.add(article.id); else state.expanded.delete(article.id);
    card.classList.toggle('expanded', details.open);
    summary.textContent = details.open ? '요약 접기' : '요약 전체 보기';
    updateExpandLabel();
  });
  const footer = element('div', 'ai-card-footer');
  const published = element('time', 'published-time', `${publishedLabel(article.publishedAt)} · KST`);
  published.dateTime = article.publishedAt;
  const unavailable = article.linkStatus === 'unavailable';
  const link = externalLink(article, `source-link${unavailable ? ' unavailable' : ''}`, unavailable ? '원문 링크 확인 필요 ↗' : '원문 보기 ↗');
  footer.append(published, link);
  card.append(top, title, teaser, details, footer);
  if (unavailable) card.append(element('p', 'link-note', article.linkNote || '보관된 원문 링크가 현재 열리지 않습니다.'));
  return card;
}
function renderCategories() {
  const container = $('#ai-categories'); container.replaceChildren();
  for (const name of ['전체', ...new Set(state.data.ai.map(article => article.category))]) {
    const button = element('button', '', name); button.type = 'button';
    const count = state.data.ai.filter(article => (name === '전체' || article.category === name) && matches(article)).length;
    button.append(element('span', 'category-count', String(count)));
    button.setAttribute('aria-pressed', String(state.category === name));
    button.addEventListener('click', () => { state.category = name; render(); });
    container.append(button);
  }
}
function render() {
  if (!state.data) return;
  const morning = state.section === 'ai' ? [] : state.data.morning.filter(matches);
  const ai = state.section === 'morning' ? [] : state.data.ai.filter(article => matches(article) && (state.category === '전체' || article.category === state.category));
  visibleAi = ai;
  $('#morning-list').replaceChildren(...morning.map(article => morningItem(article, state.data.morning.indexOf(article))));
  $('#ai-list').replaceChildren(...ai.map(aiItem));
  $('#morning').hidden = state.section === 'ai' || morning.length === 0;
  $('#ai').hidden = state.section === 'morning';
  // Keep category controls available when their selected category has no matches.
  $('#ai-list').hidden = ai.length === 0;
  $('#expand-all').hidden = ai.length === 0;
  $('#morning-count').textContent = morning.length;
  $('#ai-count').textContent = ai.length;
  $('#empty-results').hidden = morning.length + ai.length !== 0;
  const filtered = Boolean(state.query || state.section !== 'all' || state.category !== '전체');
  $('#results-status').textContent = `${state.query ? `“${state.query}” 검색 결과 · ` : ''}${morning.length + ai.length}건${!filtered ? '의 소식이 준비되어 있습니다.' : '의 기사'}`;
  $('#reset-filters').hidden = !filtered;
  $('#clear-search').hidden = !state.query;
  document.querySelectorAll('[data-section]').forEach(button => {
    if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.section === state.section));
    else button.classList.toggle('active', button.dataset.section === state.section);
  });
  renderCategories(); updateExpandLabel(); syncUrl();
}
function renderHighlights() {
  const container = $('#highlights-list'); container.replaceChildren();
  state.data.highlights.forEach((highlight, index) => {
    const button = element('button', 'highlight'); button.type = 'button';
    button.append(element('span', 'highlight-number', String(index + 1).padStart(2, '0')));
    const content = element('div');
    const heading = element('h3', '', highlight.title); heading.append(element('span', 'highlight-arrow', '↗'));
    content.append(heading, element('p', '', highlight.summary)); button.append(content);
    button.addEventListener('click', () => {
      state.section = 'ai'; state.category = '전체'; state.query = ''; $('#news-search').value = '';
      state.expanded.add(highlight.articleId); render();
      const target = document.getElementById(highlight.articleId);
      if (target) { target.scrollIntoView({ block: 'center' }); target.focus({ preventScroll: true }); }
    });
    container.append(button);
  });
  $('.highlights').hidden = false;
}
async function load() {
  $('#load-error').hidden = true;
  $('#results-status').textContent = '브리핑을 불러오고 있습니다.';
  try {
    const response = await fetch(new URL('./data/2026-09-22.json', document.baseURI));
    if (!response.ok) throw new Error(`Data unavailable: ${response.status}`);
    const data = await response.json();
    if (data.date !== '2026-09-22' || !Array.isArray(data.morning) || !Array.isArray(data.ai) || !Array.isArray(data.highlights)) throw new Error('Invalid briefing data');
    [...data.morning, ...data.ai].forEach(article => safeUrl(article.url));
    state.data = data;
    const counts = { all: data.morning.length + data.ai.length, morning: data.morning.length, ai: data.ai.length };
    $('#total-count').textContent = counts.all; $('#morning-total').textContent = counts.morning; $('#ai-total').textContent = counts.ai;
    document.querySelectorAll('[data-count]').forEach(node => { node.textContent = counts[node.dataset.count]; });
    renderHighlights(); render();
  } catch (error) {
    state.data = null;
    $('#load-error').hidden = false; $('#results-status').textContent = '자료를 불러오지 못했습니다.';
    $('#morning').hidden = true; $('#ai').hidden = true; $('.highlights').hidden = true;
    console.error('Briefing could not be loaded.', error);
  }
}

$('#news-search').value = state.query;
$('#news-search').addEventListener('input', event => { state.query = event.target.value; render(); });
$('#clear-search').addEventListener('click', () => { state.query = ''; $('#news-search').value = ''; render(); $('#news-search').focus(); });
$('#reset-filters').addEventListener('click', resetFilters);
$('#empty-reset').addEventListener('click', resetFilters);
$('#retry-load').addEventListener('click', load);
document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', event => {
  event.preventDefault(); state.section = button.dataset.section; state.category = '전체'; render();
  if (button.tagName === 'A') $('#briefing').scrollIntoView({ block: 'start' });
}));
$('#expand-all').addEventListener('click', () => {
  const shouldOpen = !visibleAi.every(article => state.expanded.has(article.id));
  for (const article of visibleAi) { if (shouldOpen) state.expanded.add(article.id); else state.expanded.delete(article.id); }
  document.querySelectorAll('#ai-list details').forEach(details => { details.open = shouldOpen; });
  updateExpandLabel();
});
$('#back-to-top').addEventListener('click', event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); });
load();
