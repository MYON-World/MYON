'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'public/myon-dev-rion-world.js'),'utf8');
function create(){
 const window={};
 vm.runInNewContext(source,{window},{timeout:1500});
 return window.MYON_DEV_RION_WORLD;
}
test('World Rion R0 has stable sites and symmetric distances without a map',()=>{
 const W=create(),t=1700000000000;
 const a=W.initialState(t,()=>0.25),b=W.initialState(t,()=>0.25);
 assert.ok(W.valid(a));
 assert.equal(a.seed,b.seed);
 assert.equal(a.discoveredCount,b.discoveredCount);
 for(let i=0;i<a.discoveredCount;i++){
  assert.equal(W.district(a,i).id,W.district(b,i).id);
  for(let j=0;j<a.discoveredCount;j++){
   assert.equal(W.distance(a,i,j),W.distance(a,j,i));
   assert.equal(W.distance(a,i,j),W.distance(b,i,j));
  }
 }
 assert.equal(W.distance(a,0,0),0);
 assert.throws(()=>W.distance(a,0,a.discoveredCount),/발견되지 않은/);
});
test('new discoveries never change previous locations or distances',()=>{
 const W=create(),a=W.initialState(1700000000000,()=>0.8);
 const before=W.distance(a,0,1);
 const b=W.discoverMore(a);
 assert.ok(b.discoveredCount>a.discoveredCount);
 assert.equal(b.seed,a.seed);
 assert.equal(b.createdAt,a.createdAt);
 assert.equal(W.distance(b,0,1),before);
 assert.equal(W.district(b,0).id,W.district(a,0).id);
 assert.equal(W.distance(b,0,b.discoveredCount-1),W.distance(b,b.discoveredCount-1,0));
 assert.equal(W.distance(JSON.parse(JSON.stringify(b)),0,1),before);
 assert.equal(W.valid({...b,discoveredCount:-1}),false);
});
test('DEV integrates discovered world only, never modifies pre-existing LIVE/TEST routing',()=>{
 const html=fs.readFileSync(path.join(root,'public/myon-next.html'),'utf8');
 const mission=fs.readFileSync(path.join(root,'public/myon-dev-missions.js'),'utf8');
 const mining=fs.readFileSync(path.join(root,'public/myon-dev-rion-mining.js'),'utf8');
 const entry=fs.readFileSync(path.join(root,'src/core/myon-server-entry.mjs'),'utf8');
 assert.match(html,/src="myon-dev-rion-world\.js"/);
 assert.match(html,/src="myon-dev-world-ui\.js"/);
 assert.ok(html.indexOf('src="myon-dev-rion-world.js"')<html.indexOf('src="myon-dev-missions.js"'));
 assert.match(mining,/rion\.role\.world/);
 assert.match(mission,/MISSION_SERVER==='dev'&&WORLD/);
 assert.match(mission,/worldR0/);
 assert.match(entry,/version:'0\.14\.5\.2'/);
 assert.match(entry,/version:'0\.13\.94'/);
});
