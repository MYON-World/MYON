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


test('DEV city selection remains isolated from pinned LIVE and stored progress',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const next=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 assert.ok(app.includes("const gameUrl=server==='dev'?url.replace('/myon.html?','/myon-next.html?'):url"));
 assert.ok(app.includes("await fetch(gameUrl,{method:'HEAD',cache:'no-store'})"));
 assert.ok(app.includes('frameUrl.value=gameUrl'));
 assert.ok(app.indexOf('await createEntryCheckpoint')<app.indexOf('frameUrl.value=gameUrl'));
 assert.ok(next.includes('MYON_SAFE_UPDATE_CHECKPOINT=async function(){return true}'));
 assert.ok(next.includes('window.self===window.top'));
 assert.ok(next.includes('html.myon-embedded .top .back{visibility:hidden;pointer-events:none}'));
 assert.ok(app.includes("'dev-controls':currentServer==='dev'"));
 assert.ok(app.includes('.game-controls.dev-controls{bottom:auto;top:8px;'));
 assert.doesNotMatch(next,/myon-v013\.js|indexedDB\.open\(/); 
 assert.ok(next.includes("MYON_DEV_CITIZEN_V2_")); 
 assert.doesNotMatch(next,/localStorage\.clear\(|indexedDB\.deleteDatabase\(/);
 for(const name of ['lien','haren','serin']){
  const city=fs.readFileSync(path.resolve(__dirname,'../public/myon-city-'+name+'.webp'));
  assert.equal(city.toString('ascii',0,4),'RIFF');
  assert.equal(city.toString('ascii',8,12),'WEBP');
  assert.ok(city.length>40000,'City backdrop too small '+name);
  assert.ok(next.includes('myon-city-'+name+'.webp'));
  assert.ok(next.includes('data-city="'+name+'"'));
  assert.ok(next.includes('data-city-button="'+name+'"'));
 }
 const sprite=/data:image\/webp;base64,([A-Za-z0-9+/=]+)/.exec(next); 
 assert.ok(sprite,'Male/female portrait image should be embedded');
 const data=Buffer.from(sprite[1],'base64'); 
 assert.equal(data.toString('ascii',0,4),'RIFF'); 
 assert.equal(data.toString('ascii',8,12),'WEBP'); 
 assert.ok(data.length>6000);
});

test('DEV city selection offers interactive no-scroll arrival on mobile',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 assert.ok(html.includes('overflow:hidden;overscroll-behavior:none'));
 assert.ok(html.includes('height:100dvh'));
 assert.doesNotMatch(html,/scrollIntoView|window\.scrollTo|overflow-y:auto/);
 assert.ok(html.includes("function selectCity(id)"));
 assert.ok(html.includes("function openModal()"));
 assert.ok(html.includes("function enterCity()"));
 assert.ok(html.includes("function act(action,button)"));
 assert.ok(html.includes("document.querySelectorAll('[data-city-button]')"));
 for(const action of ['people','look','facility','rest'])
  assert.ok(html.includes('data-action="'+action+'"'));
 assert.ok(html.includes('id="modal-confirm"'));
 assert.ok(html.includes('id="switch-city"'));
 assert.ok(html.includes('id="arrival-landscape"'));
 assert.ok(html.includes('id="city-ambient"'));
 assert.ok(html.includes('showScreen(' + "'picker'" + ')'));
});


test('DEV character creation comes before the city selector and uses gender portrait choices',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 assert.ok(html.includes('id="character"'));
 assert.ok(html.indexOf('id="character"')<html.indexOf('class="main"'));
 assert.ok(html.includes('id="citizen-name"'));
 assert.ok(html.includes('data-gender="male"')&&html.includes('data-gender="female"'));
 for(const value of ['free','people','explore','economy'])assert.ok(html.includes('data-path="'+value+'"'));
 assert.ok(html.includes('id="create-citizen" disabled'));
 assert.ok(html.includes('function confirmCitizen()'));
 assert.ok(html.includes("showScreen(citizen?'picker':'character')"));
 assert.ok(html.includes("if(!citizen){closeModal();showScreen('character');return;}"));
 assert.ok(html.includes("const startingQuest={"));
 assert.ok(html.includes("const quest=startingQuest[citizen.path]"));
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
 assert.ok(scripts.length>=2);
 const vm=require('node:vm');
 for(const script of scripts)new vm.Script(script[1]);
});

test('DEV one-time citizen save uses an isolated key and disallows city selection after entry',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 assert.ok(html.includes("const CITIZEN_KEY='MYON_DEV_CITIZEN_V2_'+DEV_SAVE_VERSION"));
 assert.match(html,/localStorage\.getItem\(CITIZEN_KEY\)/);
 assert.match(html,/localStorage\.setItem\(CITIZEN_KEY,JSON\.stringify\(v\)\)/);
 assert.match(html,/citizen=devSaveReady\?readCitizen\(\):null;cityLocked=Boolean\(citizen&&citizen\.city\)/);
 assert.match(html,/if\(screen==='picker'&&cityLocked\)screen='arrival'/);
 assert.match(html,/if\(!cityNames\[id\]\|\|\(cityLocked&&selectedCity!==id\)\)return/);
 assert.match(html,/id="switch-city" hidden disabled/);
 assert.match(html,/if\(cityLocked\)\{showScreen\('arrival'\);return;\}/);
 assert.doesNotMatch(html,/indexedDB\.open\(|localStorage\.clear\(/);
});


test('DEV simplified character creation keeps usable choices and citizen storage',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 assert.match(html,/<h1>캐릭터 만들기<\/h1>/);
 assert.match(html,/class="ch-name-wrap"/);
 assert.match(html,/class="ch-progress">01 \/ 02/);
 assert.match(html,/id="citizen-name"[^>]*maxlength="12"/);
 assert.match(html,/class="ch-field ch-visual-field"/);
 for(const g of ['male','female'])assert.ok(html.includes('data-gender="'+g+'"'));
 for(const p of ['free','people','explore','economy'])assert.ok(html.includes('data-path="'+p+'"'));
 assert.ok(html.includes('선택 성향의 임무부터 시작 · 다른 임무도 가능'));
 assert.ok(html.includes('다음 · 도시 선택'));
 assert.doesNotMatch(html,/class="ch-steps"/);
 assert.doesNotMatch(html,/class="ch-notice"/);
 assert.ok(html.includes("const CITIZEN_KEY='MYON_DEV_CITIZEN_V2_'+DEV_SAVE_VERSION"));
 assert.ok(html.includes("function readCitizen(){for(const key of [CITIZEN_KEY,CITIZEN_KEY+'.backup'])"));
 assert.ok(html.includes("localStorage.setItem(CITIZEN_KEY+'.backup',prior)"));
 assert.ok(html.includes("localStorage.setItem(CITIZEN_KEY,JSON.stringify(v))"));
 assert.ok(html.includes("if(cityLocked)enterCity();else showScreen(citizen?'picker':'character')"));
 assert.ok(html.includes("if(!cityNames[id]||(cityLocked&&selectedCity!==id))return"));
 assert.doesNotMatch(html,/indexedDB\.open\(|localStorage\.clear\(/);
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
test('DEV portal and embedded page pass the verified version through to the matching save namespace',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon-next.html'),'utf8');
 assert.ok(app.includes("if(server==='dev')"));
 assert.ok(app.includes("await prepareDevVersion({version:target.version})"));
 assert.ok(app.includes("'&dev_version='+encodeURIComponent(target.version)"));
 assert.ok(html.includes("const DEV_SAVE_VERSION=isVersionedDevSave?requestedDevVersion:'preview-0.13.75'"));
 assert.ok(html.includes("const CITIZEN_KEY='MYON_DEV_CITIZEN_V2_'+DEV_SAVE_VERSION"));
 assert.ok(html.includes("devSaveReady=prepareCitizenVersion()"));
 assert.ok(html.includes("citizen=devSaveReady?readCitizen():null"));
 assert.ok(html.includes("if(!cityNames[id]||(cityLocked&&selectedCity!==id))return"));
});
