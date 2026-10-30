const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const search=require('../search-text.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',p)));
const docs=read('data/documents.json');
const records=read('data/search-records.json').records;
test('every published document is searchable by its exact public title without losing bibliographic identity',()=>{
  const indexed=records.filter(r=>r.kind==='document');assert.equal(indexed.length,docs.items.length);
  for(const d of docs.items){
    const r=search.find(records,d.title,{kind:'document'}).find(r=>r.entryId===d.id);assert.ok(r,d.title);
    for(const key of Object.keys(d))assert.deepEqual(r[key],d[key]);
    assert.equal(r.summary,d.summary); assert.ok(d.date>=docs.window.from&&d.date<=docs.window.to);
  }
});
test('institution, publication type, date and news/document filters never leak other records',()=>{
  for(const d of docs.items){
    const hits=search.find(records,'',{kind:'document',institution:d.institution,type:d.type,date:d.date});
    assert.ok(hits.some(r=>r.id===d.id));assert.ok(hits.every(r=>r.kind==='document'&&r.institution===d.institution&&r.type===d.type&&r.date===d.date));
  }
  assert.ok(search.find(records,'',{kind:'news'}).every(r=>r.kind!=='document'));
  assert.equal(search.find(records,'',{kind:'document',channel:'ai'}).length,0);
});
test('mixed search applies literal AND and phrases per source record, including publication agency',()=>{
  for(const q of ['한국은행 스테이블코인','토큰','"금융위원회"','cBdC','한강','금융결제원','없는검색어987654321']){
    const terms=search.terms(q);
    const expected=records.filter(r=>terms.every(t=>['title','titleKo','summary','publisher'].some(f=>(r[f]||'').normalize('NFC').toLowerCase().includes(t))));
    assert.deepEqual(new Set(search.find(records,q).map(r=>r.entryId)),new Set(expected.map(r=>r.entryId)));
  }
});
test('search manifest counts both independent catalogs',()=>{
  const m=read('data/search-manifest.json');assert.equal(m.recordCount,records.length);assert.equal(m.documentCount,docs.items.length);assert.equal(m.newsRecordCount,records.length-docs.items.length);
  assert.equal(search.find(records,'private provenance',{kind:'document'}).length,0);
});

test('homepage focus excludes related-only reports without deleting their library/search entries',()=>{
  const featured=['domestic','international'].flatMap(region=>docs.items.filter(d=>d.focus==='payment'&&d.region===region).slice(0,3));
  assert.ok(featured.length); assert.ok(featured.every(d=>d.focus==='payment'));
  for(const d of docs.items.filter(d=>d.focus==='related')) assert.ok(records.some(r=>r.entryId===d.id));
});
test('Korean summaries are searchable and unavailable full text has no invented summary',()=>{
  for(const d of docs.items){
    if(d.summaryStatus==='ready'){
      assert.ok(d.region==='domestic'||d.language==='en'); assert.match(d.summary,/[가-힣]/);
      assert.ok(d.summary.length <= (d.region==='domestic'?600:2400));
      const line=d.summary.split('\n').find(s=>s.trim());
      assert.ok(search.find(records,line,{kind:'document'}).some(r=>r.entryId===d.id));
    } else assert.equal(d.summary,'');
    if(d.titleKo) assert.ok(search.find(records,d.titleKo,{kind:'document'}).some(r=>r.entryId===d.id));
  }
});

test('regional search excludes news and survives combined filters',()=>{
  const registry=read('report-institutions.json');
  for(const region of ['domestic','international']){
    const hits=search.find(records,'',{region});
    assert.deepEqual(new Set(hits.map(r=>r.id)),new Set(docs.items.filter(d=>d.region===region).map(d=>d.id)));
    assert.ok(hits.every(r=>r.kind==='document'&&registry[r.institution].region===region));
    assert.equal(search.find(records,'',{kind:'news',region}).length,0);
    for(const d of docs.items.filter(d=>d.region===region)) assert.ok(search.find(records,d.title,{region,institution:d.institution,date:d.date}).some(r=>r.id===d.id));
  }
});
