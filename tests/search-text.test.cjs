const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const search = require('../search-text.js');
const root = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json')));
const items = catalog.editions.flatMap(edition => JSON.parse(fs.readFileSync(path.join(root, edition.path))).items);
const records = JSON.parse(fs.readFileSync(path.join(root, 'data/search-records.json'))).records;
const record = (overrides = {}) => ({title:'',summary:'',publisher:'',channel:'ai',date:'2026-09-22',editionId:'ai-22',entryId:'ai-22-001',rank:1,...overrides});

test('Korean substrings match intact across particles and punctuation, not isolated syllables', () => {
  const good = record({title:'한강은 예금토큰 실험',summary:'우정사업본부·금융결제원과 협력'});
  const bad = record({title:'한 달 만에 증가',summary:'한 번 등록'});
  assert.deepEqual(search.find([good,bad],'한강'),[good]);
  assert.deepEqual(search.find([good,bad],'금융결제원'),[good]);
  assert.deepEqual(search.find([good,bad],'한강'.normalize('NFD')),[good]);
});
test('each query term must match a public field in the same record; quoted phrases stay together', () => {
  const hit=record({title:'CBDC 프로젝트',summary:'한강 실증을 추진'});
  const miss=record({title:'CBDC',category:'한강',url:'https://example.com/한강'});
  assert.deepEqual(search.find([hit,miss],'한강 cbdc'),[hit]);
  assert.equal(search.find([hit], '"한강 실증"').length,1);
  assert.equal(search.find([hit], '"CBDC 한강"').length,0);
  assert.equal(search.find([hit], '"프로젝트 한강"').length,0);
});
test('no implicit aliases or category/rationale matches', () => {
  const item=record({title:'한국은행 AI 발표',category:'금융결제원',selectionReason:'CBDC'});
  for(const query of ['한은','인공지능','금융결제원','CBDC']) assert.equal(search.find([item],query).length,0);
});
test('reported keywords and every returned record agree with original public text', () => {
  assert.equal(records.length, items.length);
  for(const [query,count] of [['금융결제원',19],['cbdc',5],['한강',0],['cbdc 금융결제원',0]]) {
    const actual=search.find(records,query);
    // Freeze the original regression corpus while allowing new weekly data.
    assert.equal(search.find(records.filter(item=>item.date <= '2026-09-25'),query).length,count);
    const expected=items.filter(item=>query.split(' ').every(term=>['title','summary','publisher'].some(field=>(item[field]||'').toLowerCase().includes(term))));
    assert.deepEqual(new Set(actual.map(item=>item.entryId)),new Set(expected.map(item=>item.id)));
    for(const item of actual) assert.ok(search.fields.some(field=>search.hasMatch(item[field],query)));
  }
});
test('channel/date filters, title priority, latest sorting and blank browse', () => {
  const title=record({title:'금융결제원',date:'2026-09-01',entryId:'title'});
  const summary=record({summary:'금융결제원',channel:'evening',entryId:'summary'});
  assert.deepEqual(search.find([summary,title],'금융결제원'),[title,summary]);
  assert.deepEqual(search.find([summary,title],'금융결제원',{sort:'latest'}),[summary,title]);
  assert.deepEqual(search.find([summary,title],'금융결제원',{channel:'evening',date:'2026-09-22'}),[summary]);
  assert.deepEqual(search.find([summary,title],'   '),[summary,title]);
});
test('highlights literal text safely and consistently without aliases or regex interpretation', () => {
  assert.deepEqual(search.pieces('제목 CBDC 확대','cbdc').filter(p=>p.match).map(p=>p.text),['CBDC']);
  assert.equal(search.hasMatch('한 달 만에 증가','한강'),false);
  assert.equal(search.hasMatch('한국은행 발표','한은'),false);
  const raw='<img src=x onerror=alert(1)> C++ [AI]';
  const pieces=search.pieces(raw,'C++ [AI]');
  assert.equal(pieces.map(p=>p.text).join(''),raw);
  assert.deepEqual(pieces.filter(p=>p.match).map(p=>p.text),['C++','[AI]']);
});
test('a late summary match appears in the displayed excerpt', () => {
  const summary='앞부분 설명 '.repeat(80)+'금융결제원이 공동 시스템을 운영한다. '+'후속 설명 '.repeat(30);
  const excerpt=search.excerpt(summary,'금융결제원');
  assert.ok(excerpt.includes('금융결제원'));
  assert.ok(excerpt.startsWith('…'));
  assert.ok(excerpt.length<=272);
});
test('generated records preserve sources and only expose explicitly selected public fields', () => {
  const allowed=new Set(['title','summary','publisher','channel','channelLabel','date','articleId','entryId','editionId','rank','url','appearanceCount','linkStatus','linkNote']);
  const byId=new Map(items.map(item=>[item.id,item]));
  for(const record of records) {
    assert.ok(Object.keys(record).every(key=>allowed.has(key)));
    for(const field of search.fields) assert.equal(record[field],byId.get(record.entryId)[field]||'');
  }
});


test('grouping preserves ranked matches and lets every matching appearance be selected', () => {
  const newest=record({articleId:'same',title:'CBDC',date:'2026-10-02',entryId:'new'});
  const oldest=record({articleId:'same',title:'CBDC',date:'2026-09-01',entryId:'old'});
  const other=record({articleId:'other',title:'CBDC',entryId:'other'});
  const result=search.group(search.find([oldest,other,newest],'cbdc'));
  assert.deepEqual(result.map(group=>group.articleId),['same','other']);
  assert.deepEqual(result[0].appearances,[newest,oldest]);
  assert.equal(result.reduce((sum,group)=>sum+group.appearances.length,0),3);
  assert.deepEqual(search.group(search.find([oldest,other,newest],'cbdc',{date:'2026-09-01'})),[{articleId:'same',appearances:[oldest]}]);
});
test('grouping never combines terms across appearances or includes a nonmatching version', () => {
  const first=record({articleId:'same',title:'CBDC',entryId:'first'});
  const second=record({articleId:'same',title:'금융결제원',entryId:'second'});
  assert.deepEqual(search.group(search.find([first,second],'CBDC 금융결제원')),[]);
  assert.deepEqual(search.group(search.find([first,second],'CBDC')),[{articleId:'same',appearances:[first]}]);
  assert.equal(search.group([record({entryId:'one'}),record({entryId:'two'})]).length,2);
});
test('all grouped results preserve exactly the matching source appearances', () => {
  for (const query of ['cBdC','현금화','레드팀','"APEX 2026"','고객정보 유출','금융결제원 인증','금융결제원'.normalize('NFD'),'존재하지않는검색어123']) {
    const expected=records.filter(item=>search.terms(query).every(term=>['title','summary','publisher'].some(field=>(item[field]||'').normalize('NFC').toLowerCase().includes(term))));
    const groups=search.group(search.find(records,query));
    assert.equal(groups.length,new Set(expected.map(item=>item.articleId)).size);
    assert.deepEqual(new Set(groups.flatMap(group=>group.appearances.map(item=>item.entryId))),new Set(expected.map(item=>item.entryId)));
  }
});
