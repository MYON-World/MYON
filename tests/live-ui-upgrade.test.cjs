'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const pinned='ea0a7b3e4589a4116ccbf903528b1d3b05af2937';
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pinnedRead=name=>execFileSync('git',['show',pinned+':public/'+name],{cwd:root,encoding:'utf8'});
const frozen=[
 ['myon-rions.js','myon-live-ui-rions.js'],
 ['myon-dev-mining-ui.js','myon-live-ui-mining-ui.js'],
 ['myon-dev-update.js','myon-live-ui-update.js'],
 ['myon-rion-registry.json','myon-live-ui-registry.json'],
 ['myon-world-baseline.json','myon-live-ui-baseline.json'],
 ['myon-city-names.json','myon-live-ui-city-names.json']
];
test('LIVE remains the exact official v0.14.5.2 economy, Rion discovery, mining and registry',()=>{
 for(const [original,copy] of frozen)
  assert.equal(read('public/'+copy),pinnedRead(original),'modified official code: '+original);
 const original=pinnedRead('myon-dev-missions.js');
 const expected=original
  .replace("fetch('./myon-world-baseline.json'","fetch('./myon-live-ui-baseline.json'")
  .replace("fetch('./myon-city-names.json'","fetch('./myon-live-ui-city-names.json'")
  .replace("fetch('./myon-rion-registry.json'","fetch('./myon-live-ui-registry.json'");
 assert.equal(read('public/myon-live-ui-missions.js'),expected,'Only asset URLs may differ from approved LIVE engine');

 // The LIVE UI discovery extension is the only allowed departure from frozen
 // mining logic; the original ORDER and canMine gate must remain untouched.
 const originalMining=pinnedRead('myon-dev-rion-mining.js');
 const miningWithUi=originalMining
  .replace("const ORDER=Object.freeze(['rion.role.mission','rion.material.myonite','rion.role.mining']);",
    "const ORDER=Object.freeze(['rion.role.mission','rion.material.myonite','rion.role.mining']);\n// UI discovery is independent of the original three-stage mining progression.\nconst UI_RION='rion.role.ui';")
  .replace(" const next=ORDER.find(id=>!found(state,id));",
    " // Preserve any waiting discovery from existing LIVE saves before introducing UI.\n const waiting=state.pending&&!found(state,state.pending.id)?state.pending.id:null;\n const next=waiting||(!found(state,UI_RION)?UI_RION:ORDER.find(id=>!found(state,id)));");
 assert.notEqual(miningWithUi,originalMining);
 assert.equal(read('public/myon-live-ui-mining.js'),miningWithUi,'Unexpected change to official mining logic');
  assert.match(expected,/MYON_LIVE_MISSIONS_V1/);
 assert.equal(JSON.parse(read('public/myon-live-ui-registry.json')).records.length,162);
});
test('LIVE enhanced page retains official markup while loading isolated official resources',()=>{
 const html=read('public/myon-live-ui.html');
 assert.match(html,/src="myon-live-ui-missions.js"/);
 assert.match(html,/src="myon-live-ui-rions.js"/);
 assert.match(html,/src="myon-live-ui-mining.js"/);
 assert.match(html,/src="myon-live-ui-overlay.js"/);
 assert.match(html,/id="mw-money-strip"/);
 assert.match(html,/class="top-identity"/);
 assert.match(html,/\.mw-live-ui-open > #mw-root/);
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 const app=read('src/App.vue');
 assert.match(app,/server==='live'&&target\.version==='0\.14\.14'/);
 assert.match(app,/myon-live-ui\.html/);
 assert.match(app,/myon-next\.html/);
});

test('LIVE presents the UI Rion immediately on a fresh game, then resumes original mining discoveries',()=>{
 const game={},rions={};
 vm.runInNewContext(read('public/myon-live-ui-mining.js'),{window:game});
 vm.runInNewContext(read('public/myon-live-ui-rions.js'),{window:rions});
 const E=game.MYON_DEV_RION_MINING,R=rions.MYON_RIONS;
 const defs=JSON.parse(read('public/myon-live-ui-registry.json')).records;
 const now=Date.parse('2026-11-24T00:00:00Z');
 let state=R.initialize(null,defs,now);
 assert.equal(state.pending,null);
 assert.equal(state.nextAt,now+3600000);
 state=E.prepareDiscovery(state,now).state;
 assert.equal(state.pending.id,'rion.role.ui');
 assert.equal(state.pending.createdAt,now,'UI offer must appear without any 1-hour wait');
 assert.equal(state.nextAt,null,'pending UI must not expire');
 state=R.accept(state,defs,now+1000).state;
 state=E.prepareDiscovery(state,now+1000).state;
 assert.equal(state.pending.id,'rion.role.mission');
 assert.equal(E.canMine(state),false);
 for(let i=0;i<3;i++){
  assert.equal(state.pending.id,E.ORDER[i]);
  state=R.accept(state,defs,now+2000+i*1000).state;
  state=E.prepareDiscovery(state,now+2000+i*1000).state;
 }
 assert.equal(state.pending,null);
 assert.equal(E.canMine(state),true,'original three-Rion mining unlock must remain');
 assert.equal(state.discovered.filter(x=>x.id==='rion.role.ui').length,1,'UI must be unique');
});
test('LIVE restores an already-waiting mining Rion without overwriting it, and queues UI after acceptance',()=>{
 const game={},rions={};
 vm.runInNewContext(read('public/myon-live-ui-mining.js'),{window:game});
 vm.runInNewContext(read('public/myon-live-ui-rions.js'),{window:rions});
 const E=game.MYON_DEV_RION_MINING,R=rions.MYON_RIONS;
 const defs=JSON.parse(read('public/myon-live-ui-registry.json')).records;
 const now=Date.parse('2026-11-24T00:00:00Z');
 const saved=R.initialize(null,defs,now);
 saved.pending={id:'rion.role.mission',createdAt:now-600000};
 saved.nextAt=null;
 const preserved=E.prepareDiscovery(saved,now);
 assert.equal(preserved.changed,false);
 assert.equal(JSON.stringify(preserved.state),JSON.stringify(saved));
 let accepted=R.accept(preserved.state,defs,now+1000).state;
 accepted=E.prepareDiscovery(accepted,now+1000).state;
 assert.equal(accepted.pending.id,'rion.role.ui');
 const fullyMining={...saved,
   discovered:E.ORDER.map(id=>({id,stage:0,discoveredAt:now-1000})),
   pending:null,nextAt:null,latest:null};
 assert.equal(E.canMine(fullyMining),true);
 const pending=E.prepareDiscovery(fullyMining,now).state;
 assert.equal(pending.pending.id,'rion.role.ui');
 assert.equal(E.canMine(pending),true);
});

function probe(){
 const source=read('public/myon-live-ui-overlay.js');
 assert.doesNotMatch(source,/localStorage\.setItem|localStorage\.removeItem|indexedDB\.deleteDatabase/);
 const patched=source.replace(/\}\)\(\);\s*$/,"globalThis.__probe={status,nodeTree,setRegistry:(a,b)=>{definitions=a;categories=b}};})();");
 assert.notEqual(source,patched);
 const context=vm.createContext({
  URLSearchParams,location:{search:'?server=live'},window:{setInterval(){return 1}}
 });
 vm.runInContext(patched,context,{timeout:2000});
 return context.__probe;
}
const world=(id,date)=>({rions:{discovered:[{id,stage:0,discoveredAt:date}]}});
test('preexisting LIVE UI discoverers get unlocked menu on first visit',()=>{
 const p=probe(),d=Date.parse('2026-11-21T00:00:00Z');
 const s=p.status(world('rion.role.ui',d),Date.parse('2026-11-24T00:00:00Z'));
 assert.equal(s.visible,true);assert.equal(s.ready,true);assert.equal(s.ratio,1);
 assert.equal(p.status(world('rion.role.user',d),Date.parse('2026-11-24T00:00:00Z')).ready,true);
});
test('new UI discoverers finish menu only after 60 minutes; 40-50 fills continuously',()=>{
 const p=probe(),d=Date.parse('2026-11-23T15:00:00Z');
 const st=m=>p.status(world('rion.role.ui',d),d+m*60000);
 assert.equal(st(0).visible,false);
 assert.equal(st(39).visible,false);
 assert.equal(st(40).visible,true);
 assert.equal(st(40).ratio,0);
 assert.equal(st(45).ratio,.5);
 assert.equal(st(50).ratio,1);
 assert.equal(st(50).ready,false);
 assert.equal(st(59).ready,false);
 assert.equal(st(60).ready,true);
 assert.equal(st(60).ratio,1);
 assert.equal(p.status(world('rion.role.development',d),d+99999999).visible,false);
});
test('folder tree includes only discovered Rion names and necessary parent categories',()=>{
 const p=probe();
 const registry=JSON.parse(read('public/myon-live-ui-registry.json')).records;
 const categories=JSON.parse(read('public/myon-live-ui-baseline.json')).domains.map(x=>x.name);
 p.setRegistry(registry,categories);
 const found={rions:{discovered:[
  {id:'rion.role.ui',stage:0,discoveredAt:1763000000000},
  {id:'rion.field.mission-07.02',stage:0,discoveredAt:1763000001000}
 ]}};
 const tree=p.nodeTree(found);
 assert.equal(tree.children.length,2);
 assert.equal(tree.children[0].name,'시스템 리온');
 assert.deepEqual([...tree.children[0].children].map(x=>x.name),['UI 리온']);
 assert.equal(tree.children[1].name,'분야 리온');
 assert.equal(tree.children[1].children.length,1);
 assert.equal(tree.children[1].children[0].name,'교통');
 assert.deepEqual([...tree.children[1].children[0].children].map(x=>x.name),['광역버스 리온']);
 const unknown=p.nodeTree({rions:{discovered:[]}});
 assert.equal(unknown.children.length,0);
});
