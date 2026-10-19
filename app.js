'use strict';

const $ = selector => document.querySelector(selector);
const siteRoot = new URL('./', document.baseURI);
const labels = { morning: '조간스크랩', evening: '석간스크랩', ai: 'AI 뉴스' };
const subtitles = { morning: 'MORNING PRESS', evening: 'EVENING PRESS', ai: 'AI NEWS' };
const descriptions = { morning: '조간스크랩에서 선정한 기사를 원래 순서대로 확인합니다.', evening: '별도 기준으로 정리한 석간스크랩입니다.', ai: '수신한 AI 뉴스의 분류와 요약을 그대로 이어서 읽습니다.' };
let catalog;
let documents = {items:[], coverage:[]};
let documentsError = false;
const documentTypes = {report: "연구보고서", periodical: "정기간행물", policy: "정책자료"};
let institutionLabels = {};
const regionLabels = {domestic:'국내 자료',international:'해외·국제기구 자료'};
let routeToken = 0;
let searchToken = 0;
let searchTimer;
let searchDataPromise;
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
  const view = edition ? 'archive' : (['latest', 'archive', 'search', 'library'].includes(params.get('view')) ? params.get('view') : params.has('q') ? 'search' : 'latest');
  return { view, edition, region: Object.hasOwn(regionLabels, params.get('region')) ? params.get('region') : 'all', kind: view === 'library' ? 'document' : (['news','document'].includes(params.get('kind')) ? params.get('kind') : 'all'), institution: Object.hasOwn(institutionLabels, params.get('institution')) ? params.get('institution') : 'all', type: Object.hasOwn(documentTypes, params.get('type')) ? params.get('type') : 'all', query: params.get('q') || '', highlight: params.get('highlight') || '', channel: ['morning', 'evening', 'ai'].includes(params.get('channel')) ? params.get('channel') : 'all', date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : 'all', sort: params.get('sort') === 'latest' ? 'latest' : 'relevance' };
}
function routeUrl(next, hash = '') {
  const url = new URL(siteRoot);
  if (next.edition && next.view === 'archive') url.searchParams.set('edition', next.edition);
  else if (next.view !== 'latest') url.searchParams.set('view', next.view);
  if (next.view === 'archive' && next.highlight) url.searchParams.set('highlight', next.highlight);
  if (['search','library'].includes(next.view) && next.query) url.searchParams.set('q', next.query);
  if (next.view !== 'latest' && next.channel !== 'all') url.searchParams.set('channel', next.channel);
  if (next.view !== 'latest' && next.date !== 'all') url.searchParams.set('date', next.date);
  if (['search','library'].includes(next.view) && next.sort === 'latest') url.searchParams.set('sort', 'latest');
  if (['search','library'].includes(next.view)) for (const field of ['kind','institution','type','region']) if (next[field] && next[field] !== 'all') url.searchParams.set(field, next[field]);
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
function openEdition(id, hash = '', highlight = '') { navigate({ view: 'archive', edition: id, channel: 'all', date: 'all', highlight }, { hash, scroll: !hash }); }
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
function titleLink(item, className, query = state.query) {
  const link = externalLink(item, '');
  link.replaceChildren();
  link.className = className;
  appendHighlighted(link, item.title || '제목 없음', query);
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
  const archiveDates = [...new Set(channelEditions.map(e => e.date))].sort().reverse();
  const searchableNews = state.kind !== 'document' && state.region === 'all' && state.institution === 'all' && state.type === 'all' ? channelEditions.map(e => e.date) : [];
  const searchableDocs = state.kind !== 'news' && state.channel === 'all' ? documents.items.filter(d => (state.region === 'all' || d.region === state.region) && (state.institution === 'all' || d.institution === state.institution) && (state.type === 'all' || d.type === state.type)).map(d => d.date) : [];
  const searchDates = [...new Set([...searchableNews, ...searchableDocs])].sort().reverse();
  for (const prefix of ['archive', 'search']) {
    const values = prefix === 'archive' ? archiveDates : searchDates;
    const dates = [['all','전체 날짜'], ...values.map(day => [day,dateLabel(day)])];
    if ((state.view === 'archive') === (prefix === 'archive') && state.date !== 'all' && !values.includes(state.date)) {
      state.date = 'all'; history.replaceState(null,'',routeUrl(state,location.hash));
    }
    setOptions($(`#${prefix}-channel`), channels, state.channel);
    setOptions($(`#${prefix}-date`), dates, state.date);
  }
  setOptions($('#search-region'), [['all','전체 지역'], ...Object.entries(regionLabels)], state.region);
  $('#search-region').disabled = state.kind === 'news';
  setOptions($('#search-institution'), [['all','전체 기관'], ...Object.entries(institutionLabels).filter(([id])=>documents.items.some(d=>d.institution===id && (state.region==='all'||d.region===state.region)))], state.institution);
  setOptions($('#search-type'), [['all','전체 종류'], ...Object.entries(documentTypes)], state.type);
  $('#search-kind').value = state.kind;
  $('#search-kind').disabled = state.view === 'library';
  $('#search-channel').disabled = state.kind === 'document';
  $('#search-institution').disabled = state.kind === 'news';
  $('#search-type').disabled = state.kind === 'news';
  $('.search-heading').textContent = state.view === 'library' ? '지급결제 자료실' : '전체 검색';
  $('#library-note').hidden = state.view !== 'library';
  $('#library-note').textContent = documentCoverage();
  $('#library-coverage').hidden = state.view !== 'library';
  $('#coverage-list').replaceChildren(...documents.coverage.map(source => element('li','',`${source.label}: ${documents.items.filter(d=>d.institution===source.institution).length}건 · ${source.note}`)));
  $('#news-search').value = state.query;
  $('#clear-search').hidden = !state.query;
  $('#search-sort').value = state.sort;
}
function editionVariant(edition) {
  const plainTitle = `${edition.date} ${labels[edition.channel] || edition.channel}`;
  if (!edition.title || edition.title === plainTitle) return '';
  return edition.title.startsWith(plainTitle + ' · ') ? edition.title.slice(plainTitle.length + 3) : edition.title;
}
function isDefaultEdition(edition) {
  const selected = catalog.defaultEditionIds?.[edition.channel]?.[edition.date] || catalog.channels.find(channel => channel.id === edition.channel)?.latestEditionId;
  return selected === edition.id;
}
function sortedEditions() {
  return [...catalog.editions].sort((a, b) => b.date.localeCompare(a.date) || a.channel.localeCompare(b.channel) || Number(isDefaultEdition(b)) - Number(isDefaultEdition(a)));
}
function editionChoice(edition) {
  return `${dateLabel(edition.date)} · ${labels[edition.channel] || edition.channel}${editionVariant(edition) ? ` · ${editionVariant(edition)}` : ''} (${edition.itemCount}건)${editionVariant(edition) && isDefaultEdition(edition) ? ' · 기본판' : ''}`;
}
function renderOverview() {
  const latest = catalog.editions.map(edition => edition.date).sort().at(-1);
  const oldest = catalog.editions.map(edition => edition.date).sort()[0];
  $('#latest-date').textContent = latest ? latest.replaceAll('-', '.') : '자료 준비 중';
  const updated = new Date(catalog.updatedAt);
  if (!Number.isNaN(updated.getTime())) {
    $('#data-updated-at').dateTime = catalog.updatedAt;
    $('#data-updated-at').textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(updated) + ' (한국시간)';
  } else $('#data-updated-at').textContent = '시각 미제공';
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
function documentCoverage() {
  if (documentsError) return '기관자료 목록을 불러오지 못했습니다. 새로고침해 다시 시도해 주세요.';
  const w = documents.window;
  return `${w?.from || ''} ~ ${w?.to || ''} 발행 자료 중 선별한 ${documents.items.length}건 · 자료실 반영 ${documents.updatedAt?.slice(0,10) || ''}. 제목·발행기관·제공된 국문 요약을 검색하고 전문은 원문 링크에서 확인합니다. 기관별 전체 자료를 빠짐없이 수록한 목록은 아닙니다.`;
}
function documentCard(meta, heading = 'h2') {
  const card = element('article','search-result document-card'); card.dataset.articleId = meta.id; card.id = heading !== 'h2' ? `preview-${meta.id}` : meta.id; card.tabIndex = -1;
  const top = element('div','search-result-meta');
  const publisher = element('span','publisher'); appendHighlighted(publisher,meta.publisher);
  top.append(element('span','region-label',regionLabels[meta.region]), element('span','topic-label',documentTypes[meta.type]), element('time','',`${dateLabel(meta.date)} 발행`),publisher);
  const title = element(heading); title.append(titleLink(meta, 'search-title-link'));
  card.append(top,title,element('p','document-series',[meta.series,meta.issue].filter(Boolean).join(' · ')));
  const footer = element('div','search-result-footer'); footer.append(externalLink(meta,'발행기관 자료정보 ↗'));
  if (meta.issueUrl) { const issueLink=externalLink({...meta,url:meta.issueUrl},'간행물 해당 호 ↗'); footer.append(issueLink); }
  card.append(footer);
  if (meta.summaryStatus === 'ready') {
    const details = element('details','document-summary');
    details.append(element('summary','','국문 요약보고서 보기'));
    const body = element('div','document-summary-body'); appendHighlighted(body,meta.summary); details.append(body);
    details.append(element('p','document-access-note',`${meta.summaryBasis === 'full-text' ? '원문 본문' : '공식 초록'}을 바탕으로 작성한 AI 국문 요약입니다. 공식 번역이 아닙니다.`));
    if (meta.institution === 'esma') details.append(element('p','document-access-note','This document has been drafted using material downloaded from ESMA’s website. ESMA가 승인한 요약이 아닙니다.'));
    if (meta.institution === 'bis') details.append(element('p','document-access-note','출처: BIS 및 원문에 표시된 발행기관. BIS는 이 비공식 국문 요약의 정확성·완전성을 보증하지 않습니다.'));
    details.append(externalLink({...meta,url:meta.summarySourceUrl},'요약에 사용한 원문 ↗'));
    if (state.query && SearchText.pieces(meta.summary,state.query).some(p=>p.match)) details.open=true;
    card.append(details);
  } else if (meta.language === 'en') card.append(element('p','document-access-note','국문 요약 없이 발행기관의 원문 링크로 제공합니다.'));
  if (meta.institution === 'kif') card.append(element('p','document-access-note','서지 정보 페이지로 연결합니다. 전문은 기관 사이트에서 추가 조회가 필요할 수 있습니다.'));
  return card;
}
function renderDocumentPreview() {
  const section=$('#document-preview'); section.replaceChildren();
  section.append(element('h2','','지급결제 주요 자료'),element('p','section-description','결제·송금·청산결제·디지털화폐와 직접 관련된 최근 자료입니다. 그 밖의 금융자료는 자료실과 검색에서 볼 수 있습니다.'));
  for (const [region,label] of Object.entries(regionLabels)) {
    const group=element('section','document-region');group.dataset.region=region;
    const head=element('div','section-heading');head.append(element('h3','',label));
    const more=element('a','text-button',label+' 전체 보기 →');more.href='?view=library&region='+region+'&sort=latest';
    more.addEventListener('click',e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate({view:'library',kind:'document',region,institution:'all',type:'all',channel:'all',date:'all',edition:'',query:'',sort:'latest'},{scroll:true});});head.append(more);
    const items=documents.items.filter(d=>d.focus==='payment'&&d.region===region).slice(0,3);
    const grid=element('div','document-grid');grid.append(...items.map(d=>documentCard(d,'h4')));
    if(!items.length)grid.append(element('p','section-description',documentsError?'자료를 불러오지 못했습니다.':'등록된 지급결제 자료를 준비하고 있습니다.'));
    group.append(head,grid);section.append(group);
  }
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
function articleCard(item, index) {
  const card = element('article', item.summary ? 'ai-card' : 'ai-card title-card'); card.id = item.id; card.tabIndex = -1;
  const highlight = state.view === 'archive' && location.hash === '#' + encodeURIComponent(item.id) ? state.highlight : '';
  const top = element('div', 'ai-card-top');
  const publisher = element('span', 'publisher'); appendHighlighted(publisher, item.publisher || '출처 미상', highlight);
  top.append(element('span', 'article-number', String(item.rank || index + 1).padStart(2, '0')), publisher);
  if (item.category) top.prepend(element('span', 'topic-label', item.category));
  const title = element('h3'); title.append(titleLink(item, 'article-title-link', highlight));
  card.append(top, title);
  if (item.summary) {
    const teaser = element('p', 'ai-teaser'); appendHighlighted(teaser, item.summary, highlight);
    const details = element('details', 'article-details');
    const summary = element('summary', '', '요약 전체 보기');
    summary.setAttribute('aria-label', `${item.title} 요약 펼치기 또는 접기`);
    const fullSummary = element('p', 'full-summary'); appendHighlighted(fullSummary, item.summary, highlight);
    details.append(summary, fullSummary);
    if (highlight && SearchText.hasMatch(item.summary, highlight)) { details.open = true; card.classList.add('expanded'); summary.textContent = '요약 접기'; }
    details.addEventListener('toggle', () => { card.classList.toggle('expanded', details.open); summary.textContent = details.open ? '요약 접기' : '요약 전체 보기'; });
    card.append(teaser, details);
  }
  const footer = element('div', 'ai-card-footer');
  if (item.publishedAt) { const time = element('time', 'published-time', articleTime(item.publishedAt)); time.dateTime = item.publishedAt; footer.append(time); }
  else footer.append(element('span', 'published-time', '기사 발행 시각 미제공'));
  footer.append(externalLink(item)); card.append(footer);
  if (item.linkStatus === 'unavailable') card.append(element('p', 'link-note', item.linkNote || '보관된 원문 링크가 현재 열리지 않습니다.'));
  return card;
}
function renderEdition(edition) {
  const titleOnly = !edition.items.some(item => item.summary);
  const section = element('section', `news-section${titleOnly ? ' headline-section' : ''}`); section.dataset.edition = edition.id;
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
  const grid = element('div', `ai-grid${titleOnly ? ' title-list' : ''}`); grid.append(...edition.items.map((item, index) => articleCard(item, index)));
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
  $('.hero').hidden = state.view !== 'latest';
  $('#channel-overview').hidden = state.view !== 'latest';
  $('#document-preview').hidden = state.view !== 'latest';
  $('#load-error').hidden = true; $('#empty-results').hidden = true; $('#load-more').hidden = true;
  $('#edition-content').replaceChildren(); $('#search-results').replaceChildren();
  $('#archive-controls').hidden = state.view !== 'archive'; $('#search-controls').hidden = !['search','library'].includes(state.view); $('#search-results').hidden = !['search','library'].includes(state.view);
  document.querySelectorAll('[data-view]').forEach(node => { if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', String(node.dataset.view === state.view)); else { node.classList.toggle('active', node.dataset.view === state.view); if (node.dataset.view === state.view) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); } });
  const viewLabels = { latest: '최신 브리핑', archive: '지난 자료', search: '전체 검색', library:'지급결제 자료실' };
  document.title = `${viewLabels[state.view]} · Payment Hub`;
  fillFilters();
  if (['search','library'].includes(state.view)) { runSearch(); return; }
  const sorted = sortedEditions();
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
async function getSearchRecords() {
  if (!searchDataPromise) searchDataPromise = fetch(new URL('./data/search-records.json', siteRoot)).then(async response => {
    if (!response.ok) throw new Error('Search data unavailable');
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.records)) throw new Error('Invalid search data');
    return data.records;
  }).catch(error => { searchDataPromise = null; throw error; });
  return searchDataPromise;
}
function editionLink(meta, label, className = 'edition-link') {
  const query = state.query;
  const link = element('a', className, label);
  link.href = routeUrl({ ...state, view: 'archive', edition: meta.editionId, channel: 'all', date: 'all', highlight: query }, meta.entryId || '');
  link.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openEdition(meta.editionId, meta.entryId, query); });
  return link;
}
function searchCard(group) {
  // The first appearance follows the selected search order and matches all terms itself.
  const meta = group.appearances[0];
  if (meta.kind === 'document') return documentCard(meta);
  const card = element('article', 'search-result'); card.dataset.articleId = group.articleId;
  const topline = element('div', 'search-result-meta');
  const publisher = element('span', 'publisher'); appendHighlighted(publisher, meta.publisher || '출처 미상');
  topline.append(element('span', 'topic-label', meta.channelLabel || labels[meta.channel] || '뉴스'), element('span', '', `${dateLabel(meta.date)} 정리본`), publisher);
  const title = element('h2'); title.append(titleLink(meta, 'search-title-link'));
  card.append(topline, title);
  if (state.query.trim()) {
    const matches = [['title', '제목'], ['summary', '요약'], ['publisher', '언론사']].filter(([field]) => SearchText.hasMatch(meta[field] || '', state.query));
    if (matches.length) card.append(element('p', 'match-location', `${matches.map(([, label]) => label).join('·')}에서 일치`));
  }
  const edition = catalog.editions.find(edition => edition.id === meta.editionId);
  if (edition && editionVariant(edition)) card.append(element('p', 'edition-variant', editionVariant(edition)));
  if (meta.summary) {
    const snippet = element('p', 'search-result-summary');
    appendHighlighted(snippet, SearchText.excerpt(meta.summary, state.query)); card.append(snippet);
  } else card.append(element('p', 'search-result-summary title-only-note', '제목과 출처를 제공하는 기사입니다. 내용은 원문에서 확인해 주세요.'));
  if (group.appearances.length > 1) {
    const choices = element('details', 'appearance-choices');
    choices.append(element('summary', 'appearance-count', `일치하는 게재 ${group.appearances.length}건 · 정리본 선택`));
    const list = element('ul', 'appearance-list');
    for (const appearance of group.appearances) {
      const record = catalog.editions.find(edition => edition.id === appearance.editionId);
      const variant = record && editionVariant(record);
      const row = element('li');
      row.append(editionLink(appearance, `${dateLabel(appearance.date)} · ${labels[appearance.channel]}${variant ? ' · ' + variant : ''} · ${appearance.rank}번 기사 →`, 'appearance-link'));
      if (appearance.title !== meta.title) { const caption = element('p', 'appearance-title'); appendHighlighted(caption, appearance.title); row.append(caption); }
      list.append(row);
    }
    choices.append(list); card.append(choices);
  }
  const footer = element('div', 'search-result-footer');
  footer.append(editionLink(meta, '정리본에서 보기 →'), externalLink({ title: meta.title, url: meta.url, linkStatus: meta.linkStatus })); card.append(footer);
  return card;
}
function appendHighlighted(node, text, query = state.query) {
  for (const part of SearchText.pieces(text, query)) node.append(part.match ? element('mark', '', part.text) : document.createTextNode(part.text));
}
async function appendSearchResults(token) {
  const start = shownResults;
  $('#load-more').disabled = true;
  try {
    const data = searchResults.slice(start, start + 20);
    if (token !== searchToken || !['search','library'].includes(state.view)) return;
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
    const records = await getSearchRecords();
    if (token !== searchToken || !['search','library'].includes(state.view)) return;
    const matches = SearchText.find(records, state.query, state);
    searchResults = SearchText.group(matches);
    const queryTerms = SearchText.terms(state.query);
    const newsMatches=matches.filter(r=>r.kind !== 'document');
    $('#results-status').textContent = `${state.query.trim() ? `“${state.query.trim()}” 검색 결과 · ` : ''}기사 ${SearchText.group(newsMatches).length}개 · 게재 ${newsMatches.length}건 · 기관자료 ${matches.length-newsMatches.length}건`;
    if (!searchResults.length) { showEmpty('일치하는 자료가 없습니다', queryTerms.length > 1 ? '입력한 검색어를 모두 포함하는 제목·요약·언론사를 찾지 못했습니다. 검색어를 하나씩 검색하거나 날짜·채널 조건을 바꿔 보세요.' : '다른 검색어를 입력하거나 날짜·채널 조건을 바꿔 보세요.'); return; }
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
    const registryResponse = await fetch(new URL('./report-institutions.json',siteRoot));
    if(!registryResponse.ok) throw new Error('Institutions unavailable');
    const registry = await registryResponse.json();
    institutionLabels = Object.fromEntries(Object.entries(registry).map(([id,v])=>[id,v.label]));
    state = readRoute();
    const legacyEdition = /^(morning|evening|ai)-(\d{4}-\d{2}-\d{2})$/.exec(state.edition);
    if (legacyEdition && !catalog.editions.some(edition => edition.id === state.edition)) {
      const record = sortedEditions().find(edition => edition.channel === legacyEdition[1] && edition.date === legacyEdition[2]);
      if (record) { state = { ...state, edition: record.id }; history.replaceState(null, '', routeUrl(state, location.hash)); }
    }
    const legacy = /^#(morning|ai)-(\d+)$/.exec(location.hash);
    if (legacy) {
      const record = catalog.editions.find(edition => edition.channel === legacy[1] && edition.date === '2026-09-22' && (!state.edition || edition.id === state.edition));
      if (record) { const edition = await fetchEdition(record); const entry = edition.items[Number(legacy[2]) - 1]; if (entry) { state = { ...state, view: 'archive', edition: record.id, channel: 'all', date: 'all' }; history.replaceState(null, '', routeUrl(state, entry.id)); } }
    }
    try { const r=await fetch(new URL('./data/documents.json',siteRoot));if(!r.ok)throw new Error('Documents unavailable');const d=await r.json();if(!Array.isArray(d.items))throw new Error('Invalid documents');documents=d;documentsError=false;} catch {documentsError=true;}
    renderOverview(); renderDocumentPreview(); await renderRoute();
  } catch { $('#results-status').textContent = '자료를 불러오지 못했습니다.'; $('#error-description').textContent = '공개 자료 목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'; $('#load-error').hidden = false; }
}

for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', event => { event.preventDefault(); navigate({ view: node.dataset.view, kind:node.dataset.view === 'library' ? 'document' : 'all', region:'all',institution:'all', type:'all', edition: '', channel: 'all', date: 'all', query: '', highlight: '', sort: 'relevance' }, { scroll: node.tagName === 'A' }); });
for (const field of ['channel', 'date']) $('#archive-' + field).addEventListener('change', event => navigate({ [field]: event.target.value, edition: '', highlight: '' }));
$('#archive-edition').addEventListener('change', event => navigate({ edition: event.target.value, highlight: '' }));
$('#home-search-form').addEventListener('submit', event => { event.preventDefault(); navigate({ view: 'search', kind:'all', region:'all',institution:'all', type:'all', edition: '', query: $('#home-search').value, highlight: '', channel: 'all', date: 'all', sort: 'relevance' }, { scroll: true }); $('#news-search').focus({ preventScroll: true }); });
$('#search-form').addEventListener('submit', event => { event.preventDefault(); navigate({ query: $('#news-search').value }, { replace: true }); });
$('#news-search').addEventListener('input', event => { const query = event.target.value; $('#clear-search').hidden = !query; clearTimeout(searchTimer); ++searchToken; $('#load-more').hidden = true; searchTimer = setTimeout(() => navigate({ query }, { replace: true }), 280); });
for (const field of ['channel','date','sort','kind','institution','type','region']) $('#search-'+field).addEventListener('change', event => {
  const changes={ [field]:event.target.value,query:$('#news-search').value };
  if(field==='kind')Object.assign(changes,{channel:'all',region:'all',institution:'all',type:'all',date:'all'});
  if(['institution','type','region'].includes(field))Object.assign(changes,{kind:'document',channel:'all',date:'all'});
  if(field==='channel')Object.assign(changes,{kind:event.target.value==='all'?'all':'news',region:'all',institution:'all',type:'all',date:'all'});
  if(field==='region') changes.institution='all';
  if(field==='institution') changes.region='all';
  navigate(changes,{replace:true});
});
$('#clear-search').addEventListener('click', () => { navigate({ query: '' }, { replace: true }); $('#news-search').focus(); });
$('#reset-search').addEventListener('click', () => navigate({ query: '', kind:state.view==='library'?'document':'all',region:'all',institution:'all',type:'all',channel: 'all', date: 'all', sort: 'relevance' }, { replace: true }));
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
