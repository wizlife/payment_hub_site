const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const search = require('../search-text.js');
const root = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json')));
const items = catalog.editions.flatMap(edition => JSON.parse(fs.readFileSync(path.join(root, edition.path))).items);

test('editorial category and private rationale cannot create article-content hits', () => {
  const item = { title: '보험 상품 출시', publisher: '신문', category: '국내 금융권 AI 동향 (금융결제원 중심)', selectionReason: 'CBDC 관련성' };
  assert.equal(search.content(item).includes('금융결제원'), false);
  assert.equal(search.content(item).includes('CBDC'), false);
});
test('reported keywords match the archived article text rather than the common category', () => {
  const contains = (item, term) => search.content(item).toLowerCase().includes(term.toLowerCase());
  assert.equal(items.filter(item => contains(item, '금융결제원')).length, 19);
  const cbdc = items.filter(item => contains(item, 'CBDC'));
  assert.equal(cbdc.length, 5);
  assert.equal(new Set(cbdc.map(item => item.articleId)).size, 3);
  assert.equal(items.filter(item => contains(item, 'CBDC') && contains(item, '금융결제원')).length, 0);
});
test('highlights case-insensitive original text and aliases without interpreting markup or regex', () => {
  assert.deepEqual(search.pieces('제목 CBDC 확대', 'cbdc').filter(part => part.match).map(part => part.text), ['CBDC']);
  assert.deepEqual(search.pieces('한국은행 발표', '한은').filter(part => part.match).map(part => part.text), ['한국은행']);
  const raw = '<img src=x onerror=alert(1)> C++ [AI]';
  const pieces = search.pieces(raw, 'C++ [AI]');
  assert.equal(pieces.map(part => part.text).join(''), raw);
  assert.deepEqual(pieces.filter(part => part.match).map(part => part.text), ['C++', '[AI]']);
});
test('a late summary match appears in the displayed excerpt', () => {
  const summary = '앞부분 설명 '.repeat(80) + '금융결제원이 공동 시스템을 운영한다. ' + '후속 설명 '.repeat(30);
  const excerpt = search.excerpt(summary, '금융결제원');
  assert.ok(excerpt.includes('금융결제원'));
  assert.ok(excerpt.startsWith('…'));
  assert.ok(excerpt.length <= 272);
});
test('middle-dot institution lists are searchable without changing source text', () => {
  const item = { title: '광주은행, 우정사업본부·금융결제원과 업무협약', publisher: '신문' };
  assert.match(search.indexContent(item), /우정사업본부 금융결제원과/);
  assert.ok(item.title.includes('·'));
});
test('built Pagefind metadata also excludes the shared editorial category', () => {
  const zlib = require('node:zlib');
  const fragments = fs.readdirSync(path.join(root, 'pagefind/fragment')).filter(name => name.endsWith('.pf_fragment'));
  assert.equal(fragments.length, items.length);
  for (const name of fragments) {
    const decoded = zlib.gunzipSync(fs.readFileSync(path.join(root, 'pagefind/fragment', name))).toString('utf8');
    const record = JSON.parse(decoded.replace(/^pagefind_dcd/, ''));
    assert.equal(record.meta.category, undefined, 'Pagefind also searches metadata: ' + name);
    assert.equal(record.filters?.category, undefined);
  }
});
