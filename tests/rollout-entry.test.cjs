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
 const {targetForServer,dbForServer,archiveUrl,LIVE_RELEASE,TEST_RELEASE}=await import('../src/core/myon-server-entry.mjs');
 assert.equal(targetForServer('live',releases).revision,LIVE_RELEASE.revision);
 assert.equal(targetForServer('dev',releases).revision,D);
 assert.equal(targetForServer('test',releases).revision,TEST_RELEASE.revision);
 assert.equal(LIVE_RELEASE.revision,TEST_RELEASE.revision,'official and accelerated worlds must use exactly the same frozen game build');
 assert.equal(LIVE_RELEASE.version,'0.13.94');
 assert.equal(LIVE_RELEASE.revision,'a3c93e3b4931af3488a6bc5fb15022b17513f451');
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

test('version history shows only pinned LIVE TEST DEV revisions grouped per configured version',async()=>{
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
 assert.deepEqual(visible.map(x=>x.version),['0.13.66','0.13.65','0.13.63']);
 assert.deepEqual(visible[0].servers,['DEV']);
 assert.deepEqual(visible[1].servers,['TEST']);
 assert.deepEqual(visible[2].servers,['LIVE']);
 assert.ok(visible.every(x=>x.servers.length>0));
 assert.deepEqual(visible[0].entries,['한국어 변경 설명']);
 assert.deepEqual(visibleVersionHistory(history,{live:{revision:'0'.repeat(40)},dev:{revision:F}}),[]);
});
test('build keeps per-commit descriptions while the simplified portal omits history panels',()=>{
 const builder=fs.readFileSync(path.resolve(__dirname,'../scripts/build-rollouts.cjs'),'utf8');
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const notes=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/myon-version-notes.json'),'utf8'));
 assert.match(builder,/versionNotes\[releaseVersion\]/);
 assert.match(builder,/subject,entries:/);
 assert.match(app,/class="servers"/);
 assert.match(app,/class="sunset"/);
 assert.doesNotMatch(app,/class="version-history"/);
 assert.match(app,/visibleVersionHistory\(releases,\{live:LIVE_RELEASE,test:TEST_RELEASE,dev:current\}\)/);
 assert.ok(notes['0.13.66'].entries.length>=2);
});

test('unified launcher hides scrollbars but keeps portal scrolling enabled',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 assert.match(app,/\.portal\{[^}]*overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;/);
 assert.match(app,/\.portal::-webkit-scrollbar\{display:none;width:0;height:0\}/);
 assert.doesNotMatch(app,/\.portal\{[^}]*overflow-y:hidden/);
});

test('MYON portal uses a compact image-free design with two worlds and retirement control',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const img=fs.readFileSync(path.resolve(__dirname,'../public/myon-planet-wallpaper.webp'));
 assert.ok(img.length>100000,'Planet wallpaper must contain real image data');
 assert.equal(img.toString('ascii',0,4),'RIFF');
 assert.equal(img.toString('ascii',8,12),'WEBP');
 assert.doesNotMatch(app,/class="planet-backdrop"/);
 assert.doesNotMatch(app,/class="planet-shade"/);
 assert.match(app,/class="hero"/);
 assert.match(app,/@click="enterServer\('live'\)"/);
 assert.match(app,/@click="enterServer\('dev'\)"/);
 assert.match(app,/@click="transferTestFunds"/);
 assert.doesNotMatch(app,/@click="enterServer\('test'\)"/);
 assert.match(app,/v-if="entering\|\|entryFailed"/);
});


test('world access ring advances smoothly only after verified entry steps',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const notes=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/myon-version-notes.json'),'utf8'));
 assert.match(app,/const ENTRY_RING_CIRCUMFERENCE=2\*Math\.PI\*67/);
 assert.match(app,/const entryVisualPercent=ref\(0\)/);
 assert.match(app,/function animateEntryProgress\(target\)/);
 assert.match(app,/requestAnimationFrame\(frame\)/);
 assert.match(app,/prefers-reduced-motion: reduce/);
 assert.match(app,/entryCompleted\.value=index\+1[\s\S]*?animateEntryProgress\(Math\.round/);
 assert.match(app,/:stroke-dasharray="ENTRY_RING_CIRCUMFERENCE"/);
 assert.match(app,/strokeDashoffset:ENTRY_RING_CIRCUMFERENCE\*\(1-entryCompleted\/ENTRY_CHECKS\.length\)/);
 assert.match(app,/stroke-dashoffset 620ms/);
 assert.match(app,/role="progressbar"/);
 assert.match(app,/role="alert"/);
 assert.ok(app.indexOf('await createEntryCheckpoint')<app.indexOf('await showVerifiedStep(2)'));
 assert.ok(app.indexOf('await showVerifiedStep(3)')<app.indexOf('playing.value=true'));
 assert.ok(notes['0.13.69'].entries.length>=2);
});


test('DEV numeric missions are the only runtime page (no city-picker or character UI)',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 const game=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 assert.ok(app.includes("const gameUrl=url.replace('/myon.html?','/myon-next.html?')"));
 assert.doesNotMatch(app,/<button type="button" class="server-row test"/);
 assert.match(app,/가속 서버 종료/);
 assert.match(app,/testCountdown/);
 assert.ok(app.includes("await fetch(gameUrl,{method:'HEAD',cache:'no-store'})"));
 assert.ok(app.indexOf('await createEntryCheckpoint')<app.indexOf('frameUrl.value=gameUrl'));
 for(const forbidden of ['도시 선택','캐릭터 만들기','showScreen(', 'selectedCity','data-city','data-gender','class="main"','id="welcome"','id="arrival"','id="modal"','id="character"'])
  assert.ok(!html.includes(forbidden),'obsolete entry UI: '+forbidden);
 assert.ok(html.includes('id="mw-money-strip"'));
 assert.ok(html.includes('id="mw-start-error"'));
 assert.ok(html.includes('src="myon-dev-missions.js"'));
 assert.ok(html.includes('src="myon-dev-update.js"'));
 assert.ok(game.includes('parent.append(root)'));
 assert.ok(!game.includes("document.querySelector('.main')"));
 assert.ok(!game.includes("$m('character')"));
 assert.ok(!game.includes("$m('welcome')"));
 assert.match(html,/\.mw-scroll\{flex:1;min-height:0;overflow:auto/);
 assert.match(html,/\.mw-scroll::-webkit-scrollbar\{display:none;width:0;height:0\}/);
});
test('DEV save epoch resets on version bump only and leaves LIVE/TEST keys intact',async()=>{
 const {prepareDevVersion,DEV_ACTIVE_VERSION_KEY,deleteDevGameDatabase,purgeDevBackupRecords}=await import('../src/core/myon-dev-version.mjs');
 const data=new Map([['MYON_DEV_CITIZEN_V1','old citizen'],['MYON_DEV_CITIZEN_V1.backup','old backup'],
  ['MYON_DEV_QUEST_V1','old quests'],['MYON_LIVE_PROFILE','live citizen'],['MYON_TEST_PROFILE','test citizen'],
  ['myon-release-state-v2','active release']]);
 const storage={get length(){return data.size},key:i=>[...data.keys()][i]||null,getItem:k=>data.get(k)??null,
  setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
 const calls=[];
 const params={storage,idb:{},deleteDatabase:async()=>calls.push('dev-only-db'),
  purgeBackups:async()=>calls.push('dev-only-snapshots')};
 await assert.rejects(prepareDevVersion({...params,version:'unsafe'}),/DEV 버전 번호/);
 assert.equal(calls.length,0);
 const first=await prepareDevVersion({...params,version:'0.13.75'});
 assert.equal(first.reset,true);assert.equal(first.previous,null);
 assert.deepEqual(calls,['dev-only-db','dev-only-snapshots']);
 assert.equal(data.get('MYON_LIVE_PROFILE'),'live citizen');
 assert.equal(data.get('MYON_TEST_PROFILE'),'test citizen');
 assert.equal(data.get('myon-release-state-v2'),'active release');
 assert.equal(data.has('MYON_DEV_CITIZEN_V1'),false);
 assert.equal(data.has('MYON_DEV_QUEST_V1'),false);
 assert.equal(data.get(DEV_ACTIVE_VERSION_KEY),'0.13.75');
 data.set('MYON_DEV_CITIZEN_V2_0.13.75','current citizen');
 const same=await prepareDevVersion({...params,version:'0.13.75'});
 assert.equal(same.reset,false);
 assert.equal(data.get('MYON_DEV_CITIZEN_V2_0.13.75'),'current citizen');
 assert.equal(calls.length,2);
 const later=await prepareDevVersion({...params,version:'0.13.76'});
 assert.equal(later.reset,true);
 assert.equal(data.has('MYON_DEV_CITIZEN_V2_0.13.75'),false);
 assert.equal(data.get(DEV_ACTIVE_VERSION_KEY),'0.13.76');
 assert.equal(data.get('MYON_LIVE_PROFILE'),'live citizen');
 assert.equal(calls.length,4);
 assert.equal(typeof deleteDevGameDatabase,'function');
 assert.equal(typeof purgeDevBackupRecords,'function');
});
test('DEV reset refuses to mark new version if store cleanup fails',async()=>{
 const {prepareDevVersion,DEV_ACTIVE_VERSION_KEY}=await import('../src/core/myon-dev-version.mjs');
 const values=new Map([[DEV_ACTIVE_VERSION_KEY,'0.13.75'],['MYON_DEV_CITIZEN_V2_0.13.75','kept']]);
 const storage={get length(){return values.size},key:i=>[...values.keys()][i]||null,
  getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 await assert.rejects(prepareDevVersion({version:'0.13.76',storage,idb:{},
  deleteDatabase:async()=>{throw Error('database blocked')},purgeBackups:async()=>{}}),/blocked/);
 assert.equal(values.get(DEV_ACTIVE_VERSION_KEY),'0.13.75');
 assert.equal(values.get('MYON_DEV_CITIZEN_V2_0.13.75'),'kept');
});
test('DEV keeps versioned save through verified portal entry',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 const game=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 assert.ok(app.includes("'&dev_version='+encodeURIComponent(target.version)"));
 assert.ok(app.includes("await prepareDevVersion({version:target.version})"));
 assert.ok(html.includes("const DEV_SAVE_VERSION=isVersionedDevSave?requestedDevVersion:'preview-0.14.0.1'"));
 assert.ok(!html.includes('CITIZEN_KEY'));
 assert.ok(!html.includes('function selectCity('));
 assert.ok(!html.includes('showScreen('));
 assert.ok(game.includes('  openGame();'));
 const scripts=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
 for(const script of scripts)new (require('node:vm').Script)(script[1]);
});
test('world baseline is DEV mission blueprint with 150 fields and 3 terrain cities',()=>{
 const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/myon-world-baseline.json'),'utf8'));
 assert.equal(data.schema,1);
 assert.equal(data.release,'0.14.0.1');
 assert.equal(data.stage.status,'개발 테스트 중');
 assert.equal(data.domains.length,15);
 assert.ok(data.domains.every(d=>d.status==='DEV 테스트'&&d.scope.length===10));
 assert.equal(data.domains.flatMap(d=>d.scope).length,150);
 assert.deepEqual(data.cities.map(c=>c.id),['lien','haren','serin']);
 assert.ok(data.cities.every(c=>c.startingCity&&Array.isArray(c.unknown)));
 for(const id of ['random-city','terrain','time','money','direct','variables','save'])
  assert.ok(data.principles.some(p=>p.id===id&&p.status==='DEV 테스트'));
 assert.equal(data.connections.status,'미조사');
 assert.equal(data.designOrder.length,6);
});

test('DEV combines city names from data without modifying numeric engine',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 const script=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const names=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/myon-city-names.json'),'utf8'));
 const baseline=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/myon-world-baseline.json'),'utf8'));
 assert.equal(names.schema,1);
 assert.ok(names.prefixes.length*names.roots.length>=900);
 for(const id of ['lien','haren','serin'])assert.ok(names.endings[id].length>0);
 assert.equal(baseline.cityNameGeneration.source,'myon-city-names.json');
 assert.ok(script.includes("function createCityName(city)"));
 assert.ok(script.includes("city,cityName,createdAt"));
 assert.ok(script.includes("v.cityName===undefined"));
 assert.ok(script.includes('function createCityName(city)'));
 assert.ok(script.includes("fetch('./myon-city-names.json'"));
 assert.ok(script.includes("openGame();"));
 assert.ok(!html.includes('id="dev-notes"'));
});
test('portal version history excludes unconfigured releases and combines coincident server version pins',async()=>{
 const {visibleVersionHistory}=await import('../src/core/myon-version-history.mjs');
 const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
 const releases=[
  {revision:A,version:'0.13.63',title:'LIVE'},
  {revision:B,version:'0.13.64',title:'intermediate'},
  {revision:C,version:'0.13.77',title:'DEV first'},
  {revision:D,version:'0.13.77',title:'DEV stable',entries:['구성 완료']}
 ];
 const shared=visibleVersionHistory(releases,{live:{revision:A},test:{revision:C},dev:{revision:D}});
 assert.deepEqual(shared.map(v=>v.version),['0.13.77','0.13.63']);
 assert.deepEqual(shared[0].servers,['TEST','DEV']);
 assert.deepEqual(shared[0].revisions,[C,D]);
 assert.deepEqual(shared[0].entries,['구성 완료']);
 const noTest=visibleVersionHistory(releases,{live:{revision:A},dev:{revision:D}});
 assert.deepEqual(noTest.map(v=>v.servers),[['DEV'],['LIVE']]);
 assert.ok(noTest.every(v=>v.version!=='0.13.64'));
});

test('DEV mission script parses and uses 150 fields with isolated versioned saves',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 const script=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 new (require('node:vm').Script)(script,{filename:'myon-dev-missions.js'});
 assert.ok(html.includes('<script src="myon-dev-missions.js"></script>'));
 assert.match(script,/const CATEGORIES_REQUIRED=15/);
 assert.match(script,/const DOMAINS_REQUIRED=150/);
 assert.match(script,/MYON_DEV_MISSIONS_V1_/);
 assert.match(script,/r<94\?'일반':r<99\?'극한':'리얼'/);
 assert.match(script,/minutes\*100\+bonus/);
 assert.match(script,/durationTicks:minutes\*60/);
 assert.match(script,/next\.cash\+=m\.money/);
 assert.match(script,/next\.active=active/);
 assert.match(script,/mystery=\{field:randInt/);
 assert.ok(script.includes('openGame();'));
 assert.match(html,/\.mw-scroll\{[^}]*scrollbar-width:none/);
});

test('DEV 3-field card and timed mission supply',()=>{
 const script=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 new (require('node:vm').Script)(script);
 for(const field of ["'수락'","'보상'"])assert.ok(script.includes('statCell(grid,'+field));
 // The third card cell retains its position while its label becomes a discovered field name.
 assert.match(script,/statCell\(grid,label,signed\(m\.direct\),'mw-positive'\)/);
 assert.match(script,/const label=hasRion\('rion\.role\.ui'\)/);
 assert.doesNotMatch(script,/statCell\(grid,'[+−]변수'/);
 assert.match(script,/applyDelta\(next.stats,m.plus.field,m.plus.amount\)/);
 assert.match(script,/applyDelta\(next.stats,m.minus.field,m.minus.amount\)/);
 assert.match(script,/MAX_WAITING_OFFERS=10/);
 assert.match(script,/OFFER_INTERVAL_MS=600000/);
 assert.match(script,/OFFER_LIFETIME_MS=3600000/);
 assert.match(script,/next\.cash-=task\.acceptCost/);
 assert.ok(!script.includes("const toggle=add(headerRight,'button'"));
 assert.ok(!script.includes("const restartButton=add(headerRight,'button'"));
 assert.match(html,/\.mw-track \.mw-expire-fill\{background:#cf6670/);
 assert.match(html,/\.mw-rewards\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(script,/function tick\(\)\{[\s\S]*?settleDue\(\);\s*refreshOffers\(\);\s*refreshRion\(\);[\s\S]*?updateProgress\(\);/);
});
test('DEV mobile shows three fields and inline money units, no city modal, scrollbar hidden',()=>{
 const js=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 assert.doesNotMatch(js,/mw-stats-modal|mw-stats-toggle|mw-stat-zone|새 도시 시작/);
 assert.match(html,/\.mw-value \.mw-unit\{font-size:9px/);
 assert.ok(html.includes(' .mw-rewards{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}'));
 assert.ok(!html.includes(' .mw-rewards{grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}'));
 assert.match(html,/\.mw-amount\{[^}]*display:inline-flex;[^}]*white-space:nowrap;[^}]*flex-wrap:nowrap/);
 assert.ok(html.includes('.mw-amount .mw-unit{flex:none}'));
 assert.ok(!html.includes('@media(max-width:360px){.mw-rewards{grid-template-columns:repeat(2,'));
 assert.match(html,/\.mw-scroll\{[^}]*scrollbar-width:none/);
});
test('DEV rendered card: four free offers, three fields with inline M, free start and paid follow-up',()=>{
 const vm=require('node:vm'),script=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const instr=script.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/, "window.__probe={setData:(fields,cityList)=>{catalog=fields;cities=cityList;},newWorld,setupUi,openGame,begin,refreshOffers,setWorld:w=>world=w,getWorld:()=>world};\n})();");
 assert.notEqual(script,instr);
 let now=1800000000000;
 const ids=new Map(),storage=new Map();
 class E {
  constructor(tag){this.tagName=tag;this.children=[];this.className='';this.textContent='';this.dataset={};this.style={};this.scrollTop=0;this.events={}}
  set id(value){this._id=value;ids.set(value,this)}get id(){return this._id}
  append(...items){this.children.push(...items)}
  insertBefore(node,ref){let i=this.children.indexOf(ref);if(i<0)i=this.children.length;this.children.splice(i,0,node)}
  replaceChildren(...items){this.children=items}
  setAttribute(){}
  addEventListener(k,fn){this.events[k]=fn}
  find(fn){for(const child of this.children){if(child&&typeof child==='object'){if(fn(child))return child;const found=child.find?.(fn);if(found)return found}}return null}
  querySelector(q){if(q==='span')return this.find(c=>c.tagName==='span');if(q[0]==='.')return this.find(c=>c.className.split(' ').includes(q.slice(1)));return null}
 }
 const shell=new E('div'),main=new E('main'),character=new E('main');character.id='character';shell.append(main,character);
 for(const id of ['mw-money-strip','mw-cash','back','city-ambient','arrival','welcome']){
  const element=new E('div');element.id=id;if(id==='back')element.append(new E('span'));
 }
 const doc={getElementById:id=>ids.get(id)||null,createElement:t=>new E(t),querySelector:q=>q==='.shell'?shell:q==='.main'?main:null};
 const window={};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/myon-rions.js'),'utf8'),{window},{timeout:2000});
 vm.runInNewContext(instr,{window,document:doc,localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null},
  DEV_SAVE_VERSION:'unit',Date:{now:()=>now},Math,console,currentScreen:'welcome'},{timeout:2000});
 const api=window.__probe;
 api.setData(Array.from({length:150},(_,id)=>({id,name:'분야'+id,category:'분야',categoryIndex:Math.floor(id/10)})),[{id:'lien',name:'리엔시'}]);
 api.setWorld(api.newWorld());api.setupUi();api.openGame();
 const cards=ids.get('mw-offers').children;assert.equal(cards.length,4);
 const grid=cards[0].find(c=>c.className==='mw-rewards');assert.ok(grid);assert.equal(grid.children.length,3);
 assert.deepEqual(grid.children.map(c=>c.children[0].textContent),['수락','보상','기여']);
 assert.equal(grid.children[0].children[1].className,'mw-amount');
 assert.equal(grid.children[0].children[1].children[0].textContent,'0');
 assert.equal(grid.children[0].children[1].children[1].textContent,'M');
 assert.equal(grid.children[1].children[1].children[1].textContent,'M');
 assert.equal(grid.children[2].children[1].children.length,1);
 assert.ok(cards[0].find(c=>c.className.includes('mw-expire-fill')));
 const id=api.getWorld().offers[0].id;api.begin(id);
 assert.equal(api.getWorld().cash,0);assert.equal(api.getWorld().active.length,1);
 const activeGrid=ids.get('mw-active').children[0].find(c=>c.className==='mw-rewards');
 assert.deepEqual(activeGrid.children.map(c=>c.children[0].textContent),['수락','보상','기여']);
 assert.equal(activeGrid.children[0].children[1].children[1].textContent,'M');
 assert.equal(ids.get('mw-offers').children.length,3);
 now+=600000;api.refreshOffers();
 assert.equal(api.getWorld().offers.length,4);
 const paid=api.getWorld().offers.find(m=>m.acceptCost>0);
 assert.ok(paid&&paid.acceptCost===paid.minutes);
 assert.equal(ids.get('mw-offers').children.length,4);
 // Insufficient funds show a non-interactive label instead of an accept button.
 const paidCard=ids.get('mw-offers').children.find(c=>c.dataset.missionId===paid.id);
 assert.equal(paidCard.find(c=>c.className==='mw-insufficient')?.textContent,'금액 부족');
 assert.equal(paidCard.find(c=>c.tagName==='button'),null);
 // All remaining zero-cost starter missions stay selectable.
 const freeCards=ids.get('mw-offers').children.filter(c=>c.dataset.missionId!==paid.id);
 assert.ok(freeCards.length>0);
 assert.ok(freeCards.every(c=>c.find(e=>e.className.split(' ').includes('mw-accept'))));
 // As soon as available funds cover the exact cost, restore the accept button.
 api.setWorld({...api.getWorld(),cash:paid.acceptCost});
 api.openGame();
 const affordableCard=ids.get('mw-offers').children.find(c=>c.dataset.missionId===paid.id);
 assert.equal(affordableCard.find(c=>c.className==='mw-insufficient'),null);
 assert.equal(affordableCard.find(c=>c.className.split(' ').includes('mw-accept'))?.textContent,'수락');
 // Active missions are sorted for display, without mutating their saved order.
 const sample=api.getWorld().active[0];
 const mk=(id,seconds)=>({...sample,id,startedAt:now,durationTicks:seconds,endsAt:now+seconds*1000});
 const unsorted=[mk('late',5400),mk('early',1800),mk('middle',3600)];
 api.setWorld({...api.getWorld(),active:unsorted});
 api.openGame();
 assert.deepEqual(ids.get('mw-active').children.map(c=>c.dataset.missionId),
  ['early','middle','late'],'earliest finishing active mission appears first');
 assert.deepEqual(api.getWorld().active.map(m=>m.id),
  ['late','early','middle'],'display ordering must not mutate saved missions');
});
test('approved LIVE and accelerated TEST isolate saves and differ only in active mission time',()=>{
 const vm=require('node:vm'),script=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const instrumented=script.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/,
  "window.__probe={begin,remainingStatus,settleDue,setWorld:w=>world=w,getWorld:()=>world,setCatalog:c=>catalog=c,store:STORE,rate:TICKS_PER_SECOND};\n})();");
 assert.notEqual(script,instrumented);
 const at=1800000000000,results=[];
 for(const server of ['live','test','dev']){
  let time=at;
  const data=new Map(),localStorage={setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k)||null};
  const window={};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/myon-rions.js'),'utf8'),{window},{timeout:2000});
  vm.runInNewContext(instrumented,{window,localStorage,DEV_SAVE_VERSION:'unit',MYON_MISSION_SERVER:server,
   Date:{now:()=>time},Math,console,document:{getElementById:()=>null}},{timeout:2000});
  const api=window.__probe;api.setCatalog([{name:'임무',category:'교통'}]);
  const mission={id:'task',field:0,stage:3,grade:'일반',minutes:60,durationTicks:3600,money:6000,
   acceptCost:60,direct:.1,plus:{field:1,amount:.1},minus:{field:2,amount:-.1},createdAt:at,expiresAt:at+3600000};
  api.setWorld({schema:1,city:'lien',cityName:'리엔시',createdAt:at,cash:100,
   stats:Array(150).fill(50),offers:[mission],active:[],history:[],nextOfferAt:at+600000});
  api.begin('task');
  const task=api.getWorld().active[0];
  assert.ok(task,'mission accepted');
  assert.equal(task.endsAt-task.startedAt,3600000/api.rate);
  assert.equal(api.remainingStatus(task,at).time,'01:00:00');
  assert.ok(data.has(api.store),'saved to its own server');
  time+=1000;
  assert.equal(api.remainingStatus(task,time).time,server==='test'?'00:59:30':'00:59:59');
  time=task.endsAt;api.settleDue();
  assert.equal(api.getWorld().active.length,0);
  assert.equal(api.getWorld().cash,6040);
  results.push({server,store:api.store,rate:api.rate});
 }
 assert.deepEqual(results.map(x=>x.store),['MYON_LIVE_MISSIONS_V1','MYON_TEST_MISSIONS_V1','MYON_DEV_MISSIONS_V1_unit']);
 assert.deepEqual(results.map(x=>x.rate),[1,30,1]);
});
test('new mission-game saves are backed up alongside preserved legacy records',async()=>{
 const {readMissionRecords,createEntryCheckpoint}=await import('../src/core/myon-server-entry.mjs');
 const storage={getItem:k=>k==='MYON_LIVE_MISSIONS_V1'?JSON.stringify({schema:1,cash:50,active:[],offers:[]}):null};
 assert.equal(readMissionRecords(storage,'live').length,1);
 assert.equal(readMissionRecords(storage,'test').length,0);
 assert.equal(readMissionRecords(storage,'dev').length,0);
 const old={key:'legacy',value:{funds:99}},saved=[];
 const result=await createEntryCheckpoint({idb:{},storage,server:'live',revision:'a'.repeat(40),
  read:async()=>[old],write:async(_idb,payload)=>{saved.push(...payload.records);return 'stored'},
  verify:async()=>true});
 assert.equal(result.records,2);
 assert.equal(saved[0],old);
 assert.equal(saved[1].key,'MYON_LIVE_MISSIONS_V1');
 assert.equal(saved[1].value.cash,50);
});
test('DEV active bar fills left-to-right while remaining percent and time decrease',()=>{
 const vm=require('node:vm');
 const js=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 const instrumented=js.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/,
  "window.__probe={remainingStatus,renderMission,updateProgress,setWorld:w=>world=w,setCatalog:fields=>catalog=fields};\n})();");
 assert.notEqual(js,instrumented);
 let now=1000000000000;
 const active={card:null,querySelector(){return this.card}};
 class Node{
  constructor(){this.children=[];this.style={};this.dataset={};this.className='';this.textContent='';}
  append(x){this.children.push(x)}
  addEventListener(){}
  querySelector(query){
   const name=query.startsWith('.')?query.slice(1):null;
   function find(el){
    for(const child of el.children){
     if(child.className.split(' ').includes(name))return child;
     const match=find(child);if(match)return match;
    }
    return null;
   }
   return find(this);
  }
 }
 const ctx={window:{},document:{createElement:()=>new Node(),getElementById:id=>id==='mw-active'?active:null},
  DEV_SAVE_VERSION:'unit',Date:{now:()=>now},Math,console};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/myon-rions.js'),'utf8'),{window:ctx.window},{timeout:2000});
 vm.runInNewContext(instrumented,ctx,{timeout:2000});
 const api=ctx.window.__probe;
 api.setCatalog([{name:'가상 임무',category:'교통'}]);
 const m={id:'m1',field:0,durationTicks:7200,startedAt:now,endsAt:now+7200000,
  acceptCost:0,money:12000,direct:.10,plus:{amount:.05},minus:{amount:-.04}};
 api.setWorld({active:[m],offers:[]});
 const card=api.renderMission(m,true);
 active.card=card;
 const titleRow=card.querySelector('.mw-card-top');
 assert.equal(titleRow.children.at(-1),card.querySelector('.mw-time'),'active clock must follow mission name at right end of title row');
 assert.equal(card.querySelector('.mw-card-bottom').querySelector('.mw-time'),null,'progress footer must not contain a clock');
 const waiting=api.renderMission({...m,createdAt:now},false);
 assert.equal(waiting.querySelector('.mw-time'),null,'waiting offers must not show active countdown');
 function verify(elapsed,remaining,time){
  assert.equal(card.querySelector('.mw-fill').style.width,elapsed+'%','filled width must represent completed time');
  assert.equal(card.querySelector('.mw-count').textContent,remaining+'%');
  assert.equal(card.querySelector('.mw-time').textContent,time);
 }
 verify(0,100,'02:00:00');
 now+=1800000;api.updateProgress();verify(25,75,'01:30:00');
 now+=3600000;api.updateProgress();verify(75,25,'00:30:00');
 now+=1800000;api.updateProgress();verify(100,0,'00:00:00');
 assert.ok(html.includes('.mw-track{height:7px;flex:1;min-width:14px;background:#274458;border-radius:8px;overflow:hidden;direction:ltr}'));
 assert.ok(html.includes('.mw-track .mw-expire-fill{background:#cf6670'),'waiting offer red bar must remain unchanged');
 assert.ok(html.includes('.mw-card-top .mw-title-time{flex:none;margin-left:auto;'),'active countdown must align to right of mission title');
});

test('DEV top bar uses minute clock and M cash with a separate notification below',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 const game=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 assert.ok(app.includes('class="brand-mark">M</span>'));
 assert.ok(html.includes('class="top-emblem" role="img" aria-label="MYON 엠블럼">M</span>'));
 assert.ok(html.includes('class="top-server">개발서버</span>'));
 assert.ok(html.includes('id="top-clock-time"'));
 assert.ok(html.includes('id="top-clock-date"'));
 assert.ok(html.includes("timeZone:'Asia/Seoul'"));
 assert.ok(html.includes("window.setInterval(updateTopClock,1000)"));
 assert.ok(html.includes('id="mw-money-strip" class="mw-money-strip" hidden'));
 assert.ok(html.includes('id="mw-cash" class="mw-money-value"'));
 assert.ok(html.includes('class="mw-money-unit">M</span>'));
 assert.ok(!html.includes('<div class="brand"><b>MYON</b>'));
 assert.ok(game.includes("$m('mw-money-strip').hidden=false"));
 assert.ok(game.includes("$m('mw-cash').textContent=fmt(world.cash)"));
 assert.ok(!game.includes("'mw-cash-box'"));
 assert.ok(!game.includes("add(left,'h1','mw-city'"));
 assert.ok(game.includes("$m('mw-cash').textContent=fmt(world.cash)"));
 new (require('node:vm').Script)(game);
});

test('DEV release watcher reveals one slim alert only for a newer deployed version, never navigates',async()=>{
 const script=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-update.js'),'utf8');
 new (require('node:vm').Script)(script);
 const installed='a'.repeat(40),newRevision='b'.repeat(40);
 const timers=[],timeouts=[],requests=[];
 const classes=new Set(),panel={hidden:true,offsetHeight:0,classList:{add:value=>classes.add(value)}};
 let releases=[{revision:installed,version:'0.13.79'}];
 const href='https://example.github.io/MYON/releases/'+installed+'/myon-next.html?build='+installed+'&server=dev&dev_version=0.13.79';
 const context={
  location:{href,search:new URL(href).search},
  URL,URLSearchParams,Date,
  console:{warn(){}},
  document:{getElementById:id=>id==='mw-update-reveal'?panel:null},
  fetch:async(url,options)=>{
   requests.push({url,options});
   return {ok:true,json:async()=>({schema:1,releases})};
  },
  window:{setTimeout:(fn,ms)=>{timeouts.push({fn,ms})},setInterval:(fn,ms)=>{timers.push({fn,ms})}}
 };
 require('node:vm').runInNewContext(script,context,{timeout:2000});
 assert.equal(timers.length,1);
 assert.equal(timers[0].ms,60000);
 assert.equal(timeouts[0].ms,1200);
 await timeouts[0].fn();
 assert.equal(panel.hidden,true,'same release cannot announce an update');
 releases=[{revision:installed,version:'0.13.79'},{revision:newRevision,version:'0.13.80'}];
 await timers[0].fn();
 assert.equal(panel.hidden,false,'new approved DEV version reveals notice');
 assert.ok(classes.has('is-revealed'));
 assert.ok(requests.every(r=>r.url.startsWith('https://example.github.io/MYON/myon-rollouts.json?at=')));
 assert.ok(requests.every(r=>r.options.cache==='no-store'));
 const calls=requests.length;
 await timers[0].fn();
 assert.equal(requests.length,calls,'stop polling after alert is visible');
 assert.doesNotMatch(script,/location\.(?:replace|reload|assign)\(|frameUrl|postMessage\(|\.src\s*=/);
});
test('update notice preserves read-only monitoring and requires verified portal exit to upgrade',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const mission=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 const pkg=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../package.json'),'utf8'));
 const lock=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../package-lock.json'),'utf8'));
 assert.equal(pkg.version,'0.14.0+hotfix.1');
 assert.equal(pkg.myonVersion,'0.14.0.1');
 assert.equal(lock.version,'0.14.0+hotfix.1');
 assert.equal(lock.packages[''].version,'0.14.0+hotfix.1');
 assert.ok(html.includes('id="mw-update-reveal" class="mw-update-reveal" hidden'));
 assert.ok(html.includes('신규 업데이트 적용 가능'));
 assert.ok(html.includes('재시작 요망'));
 assert.ok(html.includes('class="mw-update-restart"'));
 assert.ok(html.includes('src="myon-dev-update.js"'));
 assert.match(html,/\.mw-update-reveal\{display:grid;grid-template-rows:0fr/);
 assert.match(html,/\.mw-update-reveal\.is-revealed\{grid-template-rows:1fr\}/);
 assert.match(html,/\.mw-update-panel\{[^}]*transform:translateY\(-100%\)/);
 assert.ok(html.includes('prefers-reduced-motion:reduce'));
 assert.ok(html.includes("parts.hour+':'+parts.minute;"));
 assert.ok(!html.includes("parts.hour+':'+parts.minute+':'+parts.second"));
 assert.ok(!html.includes("parts.day+' '+parts.weekday.toUpperCase()+' · KST'"));
 assert.match(app,/\.game-controls\.dev-controls\{bottom:auto;top:83px;/);
 assert.ok(app.includes('class="game-controls dev-controls"'),
  'LIVE, TEST and DEV must share the top-left return control');
 assert.ok(!app.includes(':class="{\'dev-controls\':currentServer===\'dev\'}"'),
  'No server-specific return button placement');
 assert.match(app,/async function leaveServer\(\)/);
 assert.ok(app.includes("if(typeof checkpoint==='function'&&!await checkpoint())"));
 assert.ok(app.includes("frameUrl.value='';playing.value=false"));
 assert.ok(app.includes("frameUrl.value=gameUrl+"));
 assert.match(mission,/window\.MYON_SAFE_UPDATE_CHECKPOINT=async function\(\)/);
 assert.ok(mission.includes("if(!write(world))return false"));
 assert.ok(mission.includes("saved===JSON.stringify(world)&&validWorld(JSON.parse(saved))"));
});

test('v0.13.94 promotion changes only LIVE/TEST frozen revision, preserving DEV layout and server saves',async()=>{
 const {LIVE_RELEASE,TEST_RELEASE,dbForServer}=await import('../src/core/myon-server-entry.mjs');
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const missions=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-missions.js'),'utf8');
 assert.equal(LIVE_RELEASE.revision,'a3c93e3b4931af3488a6bc5fb15022b17513f451');
 assert.equal(TEST_RELEASE.revision,LIVE_RELEASE.revision);
 assert.equal(LIVE_RELEASE.version,'0.13.94');
 assert.equal(TEST_RELEASE.version,'0.13.94');
 assert.ok(app.includes('class="game-controls dev-controls"'));
 assert.ok(app.includes("@click=\"enterServer('dev')\""));
 assert.ok(!app.includes("@click=\"enterServer('test')\""));
 assert.ok(app.includes('@click="transferTestFunds"'));
 assert.ok(app.includes("@click=\"enterServer('live')\""));
 assert.notEqual(dbForServer('live'),dbForServer('test'));
 assert.ok(missions.includes("MISSION_SERVER==='test'?30:1"));
 assert.ok(missions.includes("MYON_LIVE_MISSIONS_V1"));
 assert.ok(missions.includes("MYON_TEST_MISSIONS_V1"));
});


test('four-part correction versions remain valid for manifest, existing-state migration and DEV save',async()=>{
 const {validReleases,migrateLegacy}=await import('../src/core/myon-release-state.mjs');
 const SHA='f'.repeat(40),A='e'.repeat(40);
 const releases=[{revision:A,version:'0.14.0'},{revision:SHA,version:'0.14.0.1'}];
 assert.ok(validReleases(releases));
 assert.equal(migrateLegacy({from:'version:0.14.0.1'},releases,1800000000000).installed,SHA);
 const {prepareDevVersion}=await import('../src/core/myon-dev-version.mjs');
 const memory=new Map([['MYON_DEV_ACTIVE_VERSION_V1','0.14.0.1']]);
 const storage={getItem:k=>memory.get(k)||null};
 const check=await prepareDevVersion({version:'0.14.0.1',storage});
 assert.equal(check.reset,false);
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 const watcher=fs.readFileSync(path.resolve(__dirname,'../public/myon-dev-update.js'),'utf8');
 const coordinator=fs.readFileSync(path.resolve(__dirname,'../public/myon-auto-update.js'),'utf8');
 assert.ok(html.includes('(?:\\.\\d+)?'));
 assert.ok(watcher.includes('for(let i=0;i<4;i++)'));
 assert.ok(coordinator.includes('(?:\\.\\d+)?'));
 const builder=fs.readFileSync(path.resolve(__dirname,'../scripts/build-rollouts.cjs'),'utf8');
 assert.match(builder,/pkg\.myonVersion\|\|pkg\.version/);
});
