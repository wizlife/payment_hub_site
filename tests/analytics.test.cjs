const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../analytics.js'), 'utf8');
function run(overrides={}) {
  const scripts=[]; const values={}; let click; let reloaded=false;
  const button={addEventListener:(_, fn)=>{click=fn;}};
  const context={document:{getElementById:()=>button,createElement:()=>({dataset:{}}),body:{appendChild:s=>scripts.push(s)}},navigator:{webdriver:false},location:{protocol:'https:',hostname:'wizlife.github.io',pathname:'/payment_hub_site/',reload:()=>{reloaded=true;}},localStorage:{getItem:k=>values[k],setItem:(k,v)=>{values[k]=v;}}};
  Object.assign(context,overrides); vm.runInNewContext(source,context);
  return {scripts,button,click,values,reloaded:()=>reloaded};
}
test('production visitor loads one beacon with SPA collection disabled',()=>{
 const r=run(); assert.equal(r.scripts.length,1); assert.equal(JSON.parse(r.scripts[0].dataset.cfBeacon).spa,false);
 r.click(); assert.equal(r.values['payment-hub-analytics-disabled'],'1'); assert.equal(r.reloaded(),true);
});
test('operator preference, automation, local and unrelated host never load beacon',()=>{
 for(const overrides of [{navigator:{webdriver:true}},{localStorage:{getItem:()=> '1'}},{localStorage:{getItem:()=>{throw Error('denied');}}},{location:{protocol:'http:',hostname:'localhost',pathname:'/'}},{location:{protocol:'https:',hostname:'other.github.io',pathname:'/payment_hub_site/'}},{location:{protocol:'https:',hostname:'wizlife.github.io',pathname:'/other/'}}]) assert.equal(run(overrides).scripts.length,0);
});
