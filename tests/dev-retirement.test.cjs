'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const load=()=>import('../src/core/myon-dev-retirement.mjs');

test('DEV deadline matches the approved KST preview and never depends on user login',async()=>{
 const {DEV_SUNSET_MS,validDevSunset}=await load();
 const fixed=Date.parse('2026-12-01T21:00:00Z');
 assert.equal(DEV_SUNSET_MS,fixed);
 const config=JSON.parse(read('public/myon-dev-sunset.json'));
 assert.deepEqual(config,{schema:1,endsAt:fixed,timezone:'Asia/Seoul'});
 assert.ok(validDevSunset(config));
 assert.equal(validDevSunset({...config,endsAt:fixed+1000}),false);
 assert.equal(validDevSunset({...config,timezone:'UTC'}),false);
});
test('server HTTP Date and monotonic elapsed control the shared countdown',async()=>{
 const {parseServerDate,syncedNow,remainingDevMs,formatDevCountdown,DEV_SUNSET_MS}=await load();
 const date='Wed, 25 Nov 2026 00:00:00 GMT';
 const epoch=Date.parse('2026-11-25T00:00:00Z');
 assert.equal(parseServerDate(date),epoch);
 assert.throws(()=>parseServerDate(undefined),/표준시 응답/);
 assert.throws(()=>parseServerDate('2026-11-25'),/표준시 응답/);
 assert.equal(syncedNow(epoch,500,1500),epoch+1000);
 assert.equal(syncedNow(epoch,500,0),epoch);
 assert.equal(remainingDevMs(DEV_SUNSET_MS,DEV_SUNSET_MS+1000),0);
 assert.equal(formatDevCountdown(604800000),'7일 00:00:00');
 assert.equal(formatDevCountdown(1000),'0일 00:00:01');
 assert.equal(formatDevCountdown(0),'0일 00:00:00');
});
test('DEV is disabled at the portal before file or save selection and disappears at cutoff',()=>{
 const app=read('src/App.vue');
 assert.match(app,/if\(server==='dev'\)\{message.value='개발 서버 접속이 종료되었습니다/);
 assert.ok(app.indexOf("if(server==='dev'){message.value='개발 서버 접속이 종료되었습니다.")<
  app.indexOf("entering.value=true;message.value=''"));
 assert.match(app,/<section v-if="showDevEntry" class="sunset dev-sunset"/);
 assert.doesNotMatch(app,/class="server-row dev"/);
 assert.ok(app.indexOf('class="server-row live"')<app.indexOf('<section v-if="showDevEntry" class="sunset dev-sunset"'));
 assert.ok(app.indexOf('<section v-if="showDevEntry" class="sunset dev-sunset"')<
  app.indexOf('<section v-if="showTestSunset" class="sunset"'));
 assert.match(app,/showDevSunset \? devCountdown : '표준시 확인 중'/);
 assert.match(app,/class="dev-closed-tag">접속 차단/);
 assert.match(app,/\.portal \.servers>\.sunset\{margin-top:0\}/);
 assert.match(app,/\.portal \.dev-sunset \.dev-closed-tag\{/);
 assert.match(app,/const showDevEntry=computed\(\(\)=>!devClockKnown.value\|\|devRemaining.value>0\)/);
 assert.match(app,/const showDevSunset=computed\(\(\)=>devClockKnown.value&&devRemaining.value>0\)/);
 assert.match(app,/const devExpired=computed\(\(\)=>devClockKnown.value&&devRemaining.value===0\)/);
 assert.match(app,/DEV 접속 종료 · 종료 후 메뉴에서 제거/);
 assert.doesNotMatch(app,/class="dev-after"/);
 assert.doesNotMatch(app,/class="dev-timezone"/);
 assert.doesNotMatch(app,/@click="enterServer\('dev'\)"/);
 assert.match(app,/parseServerDate\(serverHeader\)/);
 assert.match(app,/performance\.now\(\)/);
 assert.match(app,/document\.addEventListener\('visibilitychange',onDevVisibility\)/);
});
test('direct archived DEV pages redirect before game scripts load, without touching LIVE',()=>{
 const builder=read('scripts/build-rollouts.cjs');
 assert.match(builder,/const devGuard=/);
 assert.match(builder,/for\(const file of \['myon-next\.html','myon-150\.html'\]\)/);
 assert.match(builder,/file==='myon-150.html'/);
 for(const name of ['myon-next.html','myon-150.html']){
  const html=read('public/'+name);
  if(name==='myon-150.html')assert.match(html,/The myon-150 page is DEV-only/);
  else assert.match(html,/!\['live','test'\].includes/);
  const runtimeStart=name==='myon-150.html'?'const params=new URLSearchParams(location.search)':'<script src="myon-dev-missions.js"';
  assert.ok(html.includes('DEV retirement: reject'));
  assert.ok(html.indexOf('DEV retirement: reject')<html.indexOf(runtimeStart));
 }
});
test('LIVE save isolation, official game and retired TEST money transfer remain unchanged',()=>{
 const app=read('src/App.vue'),entry=read('src/core/myon-server-entry.mjs');
 assert.match(app,/await createEntryCheckpoint\(\{server,revision:target.revision\}\)/);
 assert.ok(app.indexOf("await createEntryCheckpoint({server,revision:target.revision})")<app.indexOf('playing.value=true'));
 assert.match(entry,/live:'MYON_LIVE_MISSIONS_V1'/);
 assert.match(entry,/live:'myon-v00804-progress'/);
 assert.match(app,/const gamePage=server==='live'\?'myon-live-ui.html':'myon-next.html'/);
 assert.match(app,/@click="transferTestFunds"/);
 assert.match(app,/<section v-if="showTestSunset" class="sunset"/);
 assert.match(app,/{{ testCountdown }}/);
 assert.match(app,/{{ testTransferLabel }}/);
 assert.match(app,/readTestRetirement/);
});
