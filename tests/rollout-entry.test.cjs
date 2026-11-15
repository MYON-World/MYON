'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=()=>import('../src/core/myon-release-state.mjs');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
const releases=[
 {revision:A,version:'0.13.51'},
 {revision:B,version:'0.13.52'},
 {revision:C,version:'0.13.53'},
 {revision:D,version:'0.13.54'}
];
const now=1760000000000;
test('new player can start at current release, existing unknown player cannot skip history',async()=>{
 const {initialState}=await core();
 assert.equal(initialState(releases,{existing:false}).installed,D);
 assert.equal(initialState(releases,{existing:true}).installed,A);
 assert.equal(initialState(releases,{existing:true,bus:true}).installed,B);
 assert.equal(initialState(releases,{existing:true,bus:true,passes:true}).installed,D);
});
test('legacy player on 0.13.51 with latest target cannot jump over 0.13.52',async()=>{
 const {migrateLegacy}=await core();
 const state=migrateLegacy({schema:1,from:A,target:D,startedAt:now-60*60000},releases,now);
 assert.equal(state.installed,A);
 assert.equal(state.target,B);
 assert.equal(state.phase,'rollout');
 assert.equal(state.startedAt,now,'Wrong legacy target cannot reuse an unrelated countdown');
});
test('legitimate legacy next-commit countdown retains its timestamp',async()=>{
 const {migrateLegacy}=await core();
 const state=migrateLegacy({schema:1,from:B,target:C,startedAt:now-34*60000},releases,now);
 assert.equal(state.installed,B);
 assert.equal(state.target,C);
 assert.equal(state.startedAt,now-34*60000);
});
test('legacy clients that stored version markers resolve to a matching oldest release',async()=>{
 const {migrateLegacy}=await core();
 const state=migrateLegacy({schema:1,from:'version:0.13.52',target:D,startedAt:now-1000},releases,now);
 assert.equal(state.installed,B);
 assert.equal(state.target,C);
});
test('stale v2 state cannot skip commits and preserves the existing hour',async()=>{
 const {reconcileState}=await core();
 const state=reconcileState({schema:2,installed:A,phase:'rollout',target:D,startedAt:now-12*60000},releases,now);
 assert.equal(state.installed,A);
 assert.equal(state.target,B);
 assert.equal(state.startedAt,now-12*60000);
});
test('cooldown remains a separate hour after installing exactly one commit',async()=>{
 const {reconcileState}=await core();
 const state=reconcileState({schema:2,installed:B,phase:'cooldown',target:'',startedAt:now-20*60000},releases,now);
 assert.equal(state.phase,'cooldown');
 assert.equal(state.startedAt,now-20*60000);
 assert.equal(state.installed,B);
});
test('unknown old pin cannot be rewritten as HEAD',async()=>{
 const {reconcileState}=await core();
 assert.equal(reconcileState({schema:2,installed:'e'.repeat(40),phase:'idle',target:'',startedAt:0},releases,now),null);
});
test('production builder redirects direct root and archived top-level visits to pinned launcher',()=>{
 const src=fs.readFileSync(path.resolve(__dirname,'../scripts/build-rollouts.cjs'),'utf8');
 assert.match(src,/fs\.writeFileSync\(path\.join\(dist,'myon\.html'\),redirect\)/);
 assert.match(src,/new URL\("\.\/\",location\.href\)/);
 assert.match(src,/new URL\("\.\.\/\.\.\/",location\.href\)/);
 assert.match(src,/window\.self===window\.top/);
});
test('new portal opens DEV at the latest checked SHA and freezes LIVE approval',async()=>{
 const {targetForServer,dbForServer,archiveUrl,LIVE_RELEASE}=await import('../src/core/myon-server-entry.mjs');
 assert.equal(targetForServer('live',releases).revision,LIVE_RELEASE.revision);
 assert.equal(targetForServer('dev',releases).revision,D);
 assert.equal(targetForServer('test',releases),null);
 assert.notEqual(dbForServer('dev'),dbForServer('live'));
 assert.notEqual(dbForServer('test'),dbForServer('live'));
 assert.notEqual(dbForServer('test'),dbForServer('dev'));
 assert.match(archiveUrl('/MYON/','dev',D),new RegExp('/releases/'+D+'/myon.html'));
 assert.match(archiveUrl('/MYON/','dev',D),/server=dev/);
});
test('save checkpoint must write and verify before allowing entry',async()=>{
 const {createEntryCheckpoint}=await import('../src/core/myon-server-entry.mjs');
 const revision='a'.repeat(40);
 let steps=[];
 const options={server:'dev',revision,idb:{},
  read:async()=>{steps.push('read');return [{key:'a',value:{funds:500}}]},
  write:async(idb,payload)=>{steps.push('backup');assert.equal(payload.server,'dev');assert.equal(payload.count,1);return 'key'},
  verify:async()=>{steps.push('verify');return true}
 };
 const result=await createEntryCheckpoint(options);
 assert.equal(result.backup,true);
 assert.deepEqual(steps,['read','backup','verify']);
 await assert.rejects(createEntryCheckpoint({...options,verify:async()=>false}),/백업 검증/);
 const none=await createEntryCheckpoint({...options,read:async()=>[],write:()=>{throw Error('unexpected')}});
 assert.equal(none.backup,false);
});
test('game engine isolates DEV/TEST progress databases and leaves LIVE name unchanged',()=>{
 const game=fs.readFileSync(path.resolve(__dirname,'../public/myon-v013.js'),'utf8');
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 assert.match(game,/SERVER_MATCH=/);
 assert.match(game,/myon-v00804-progress/);
 assert.match(game,/SERVER==='live'/);
 assert.match(app,/entryStep.value='세이브 읽기 및 백업 검증 중'/);
 assert.match(app,/v-if="!playing"/);
 assert.match(app,/LIVE/);
 assert.match(app,/TEST/);
 assert.match(app,/DEV/);
 assert.doesNotMatch(app,/createRolloutHost\(/);
});

test('version history shows latest to exact LIVE inclusive, grouped once per version, with current server badges',async()=>{
 const {visibleVersionHistory}=await import('../src/core/myon-version-history.mjs');
 const L='l'.repeat(40).replace(/l/g,'a'),S='b'.repeat(40),U='c'.repeat(40),D='d'.repeat(40),E='e'.repeat(40),F='f'.repeat(40);
 const history=[
  {revision:L,version:'0.13.62',title:'old'},
  {revision:S,version:'0.13.63',title:'approved live'},
  {revision:U,version:'0.13.64',title:'initial',subject:'first'},
  {revision:D,version:'0.13.64',title:'latest',subject:'second'},
  {revision:E,version:'0.13.65',title:'testing'},
  {revision:F,version:'0.13.66',title:'developer',entries:['한국어 변경 설명']}
 ];
 const visible=visibleVersionHistory(history,{live:{revision:S},test:{revision:E},dev:{revision:F}});
 assert.deepEqual(visible.map(x=>x.version),['0.13.66','0.13.65','0.13.64','0.13.63']);
 assert.deepEqual(visible[0].servers,['DEV']);
 assert.deepEqual(visible[1].servers,['TEST']);
 assert.deepEqual(visible[2].servers,[]);
 assert.equal(visible[2].revisions.length,2);
 assert.deepEqual(visible[3].servers,['LIVE']);
 assert.deepEqual(visible[0].entries,['한국어 변경 설명']);
 assert.deepEqual(visibleVersionHistory(history,{live:{revision:'0'.repeat(40)},dev:{revision:F}}),[]);
});
test('build publishes per-commit descriptions while portal places history below server selection',()=>{
 const builder=fs.readFileSync(path.resolve(__dirname,'../scripts/build-rollouts.cjs'),'utf8');
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const notes=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/myon-version-notes.json'),'utf8'));
 assert.match(builder,/versionNotes\[pkg.version\]/);
 assert.match(builder,/subject,entries:/);
 assert.ok(app.indexOf('class="servers"')<app.indexOf('class="version-history"'));
 assert.ok(app.indexOf('class="version-history"')<app.indexOf('class="details"'));
 assert.match(app,/visibleVersionHistory\(releases,\{live:LIVE_RELEASE,test:TEST_RELEASE,dev:current\}\)/);
 assert.match(app,/v-for="server in change.servers"/);
 assert.ok(notes['0.13.66'].entries.length>=2);
});

test('unified launcher hides scrollbars but keeps portal scrolling enabled',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 assert.match(app,/\.portal\{[^}]*overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;/);
 assert.match(app,/\.portal::-webkit-scrollbar\{display:none;width:0;height:0\}/);
 assert.doesNotMatch(app,/\.portal\{[^}]*overflow-y:hidden/);
});

test('MYON portal uses the local text-free planet wallpaper without changing entry and save controls',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const img=fs.readFileSync(path.resolve(__dirname,'../public/myon-planet-wallpaper.webp'));
 assert.ok(img.length>100000,'Planet wallpaper must contain real image data');
 assert.equal(img.toString('ascii',0,4),'RIFF');
 assert.equal(img.toString('ascii',8,12),'WEBP');
 assert.ok(app.includes("BASE + 'myon-planet-wallpaper.webp)'"));
 assert.match(app,/class="planet-backdrop"/);
 assert.match(app,/class="planet-shade"/);
 assert.match(app,/class="hero"/);
 assert.match(app,/@click="enterServer\('live'\)"/);
 assert.match(app,/@click="enterServer\('dev'\)"/);
 assert.match(app,/@click="downloadSave"/);
 assert.match(app,/@click="copySave"/);
 assert.match(app,/v-if="entering\|\|entryFailed"/);
});
