'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/myon-150.html'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const script=scripts.at(-1)[1];
function start(legacy={}){
 const data=new Map(Object.entries(legacy)),elements=new Map(),window={};
 const element=id=>{
  if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',addEventListener(){}});
  return elements.get(id);
 };
 const localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const context={window,document:{getElementById:element,querySelectorAll:()=>[]},
  localStorage,location:{search:'?server=dev&dev_version=0.14.9'},
  URLSearchParams,Date,Intl,Math,JSON,Object,console,setInterval(){},confirm:()=>true};
 vm.runInNewContext(script,context,{timeout:3000});
 return {data,window};
}
test('DEV only-150 world starts with exactly 150 fields and 4 free missions',()=>{
 const {data,window}=start();
 const save=JSON.parse(data.get('MYON_DEV_MISSIONS_V1_0.14.9'));
 assert.equal(save.stats.length,150);
 assert.equal(save.offers.length,4);
 assert.ok(save.offers.every(m=>m.acceptCost===0));
 assert.equal(save.cash,0);
 for(const key of ['rions','myonite','worldR0'])assert.equal(key in save,false);
 assert.equal(typeof window.MYON_SAFE_UPDATE_CHECKPOINT,'function');
});
test('DEV save migration preserves money and missions, excludes obsolete systems and leaves old key untouched',()=>{
 const prior=JSON.parse(start().data.get('MYON_DEV_MISSIONS_V1_0.14.9'));
 const legacy={...prior,cash:456,rions:{pending:{}},myonite:{storedTons:2},
  worldR0:{discoveredCount:5},offers:prior.offers.map(m=>({...m,contributionRion:'rion.role.world'}))};
 const raw=JSON.stringify(legacy);
 const {data}=start({'MYON_DEV_MISSIONS_V1_0.14.8':raw});
 const current=JSON.parse(data.get('MYON_DEV_MISSIONS_V1_0.14.9'));
 assert.equal(current.cash,456);
 assert.equal(current.offers.length,4);
 assert.equal(data.get('MYON_DEV_MISSIONS_V1_0.14.8'),raw);
 for(const key of ['rions','myonite','worldR0'])assert.equal(key in current,false);
 assert.equal('contributionRion' in current.offers[0],false);
});
test('only DEV routes to 150 missions; LIVE/TEST pins remain immutable',()=>{
 const legacy=fs.readFileSync(path.join(root,'public/myon-next.html'),'utf8');
 const entry=fs.readFileSync(path.join(root,'src/core/myon-server-entry.mjs'),'utf8');
 assert.match(legacy,/server'\)===\s*'dev'/);
 assert.match(legacy,/myon-150\.html/);
 assert.match(entry,/version:'0\.14\.5\.2'/);
 assert.match(entry,/version:'0\.13\.94'/);
});
