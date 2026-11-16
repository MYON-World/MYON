/* MYON DEV mission sandbox: intentionally isolated from LIVE and TEST. */
(function () {
'use strict';
const CATEGORIES_REQUIRED=15;
const DOMAINS_REQUIRED=150;
const STORE='MYON_DEV_MISSIONS_V1_'+DEV_SAVE_VERSION;
const CITY_TYPES={
 lien:{terrain:'도심·평야',favored:[5,6,7,8,10,11,13,14],hard:[0,1,2]},
 haren:{terrain:'산악·내륙',favored:[0,1,2,9,12],hard:[6,7,8]},
 serin:{terrain:'해안·항만',favored:[1,6,7,8,3],hard:[0,2,9]}
};
const LIMIT=4;
const $m=id=>document.getElementById(id);
let catalog=[],cities=[],world=null,viewCategory=0,showStats=false,notice='';
const randInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
const round2=n=>Math.round((n+Number.EPSILON)*100)/100;
const fmt=n=>Number(n).toLocaleString('ko-KR');
const two=n=>Number(n).toFixed(2);
const signed=n=>(n>=0?'+':'−')+two(Math.abs(n));
const hourClock=seconds=>{const s=Math.max(0,Math.floor(seconds));return String(Math.floor(s/3600)).padStart(2,'0')+':'+String(Math.floor(s%3600/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
const choose=list=>list[randInt(0,list.length-1)];
const fieldTitle=id=>catalog[id]?.name||'알 수 없음';
function bandValue(){
 const r=Math.random()*100;
 const pair=r<60?[1,10]:r<90?[11,30]:r<99?[31,60]:[61,100];
 return randInt(...pair)/100;
}
function profile(cityId,categoryIndex,fieldName){
 const c=CITY_TYPES[cityId];
 if(!c)return 0.7;
 if(cityId==='haren'&&/연안어업|양식업|항만|여객선|해양보호|항공화물/.test(fieldName))return 0.05;
 if(cityId==='lien'&&/연안어업|양식업|석유|천연가스/.test(fieldName))return 0.05;
 if(cityId==='serin'&&/철광|석탄|지열|목축|조림/.test(fieldName))return 0.2;
 if(c.favored.includes(categoryIndex))return 1;
 if(c.hard.includes(categoryIndex))return 0.2;
 return 0.7;
}
function stage(value){return value>=80.01?1:value>=60.01?2:value>=40.01?3:value>=20.01?4:5}
function initialStats(cityId){
 return catalog.map(entry=>{
  const fit=profile(cityId,entry.categoryIndex,entry.name);
  const limits=fit>=1?[4500,8800]:fit>=0.7?[3500,8000]:fit>=0.2?[2000,6900]:[800,5000];
  return randInt(...limits)/100;
 });
}
function generateMission(state){
 const field=randInt(0,catalog.length-1);
 const entry=catalog[field],score=state.stats[field];
 const r=Math.random()*100;
 const grade=r<94?'일반':r<99?'극한':'리얼';
 const minutes=grade==='일반'?randInt(30,180):grade==='극한'?randInt(180,360):randInt(360,1440);
 const bonus=grade==='극한'?10000:grade==='리얼'?50000:0;
 const fit=profile(state.city,entry.categoryIndex,entry.name);
 const direct=Math.max(0.01,round2(bandValue()*fit));
 const plus={field:randInt(0,catalog.length-1),amount:bandValue()};
 const minus={field:randInt(0,catalog.length-1),amount:-bandValue()};
 return {id:'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,10),field,stage:stage(score),
  grade,minutes,durationTicks:minutes*60,money:minutes*100+bonus,direct,plus,minus,createdAt:Date.now()};
}
function fillOffers(state){
 while(state.offers.length+state.active.length<LIMIT)state.offers.push(generateMission(state));
}
function newWorld(){
 const city=choose(cities).id;
 const next={schema:1,city,createdAt:Date.now(),cash:0,stats:initialStats(city),offers:[],active:[],history:[]};
 fillOffers(next);
 return next;
}
function validWorld(v){
 return !!(v&&v.schema===1&&CITY_TYPES[v.city]&&Array.isArray(v.stats)&&v.stats.length===DOMAINS_REQUIRED&&v.stats.every(n=>Number.isFinite(n)&&n>=0&&n<=100)
  &&Number.isSafeInteger(v.cash)&&v.cash>=0&&Array.isArray(v.offers)&&Array.isArray(v.active)&&Array.isArray(v.history)
  &&v.offers.length+v.active.length<=LIMIT&&[...v.offers,...v.active].every(m=>m&&Number.isSafeInteger(m.durationTicks)&&m.durationTicks>=1800
    &&Number.isSafeInteger(m.field)&&m.field>=0&&m.field<DOMAINS_REQUIRED&&Number.isFinite(m.money)));
}
function write(next){
 if(!validWorld(next))return false;
 try{
  const json=JSON.stringify(next);
  localStorage.setItem(STORE,json);
  return localStorage.getItem(STORE)===json;
 }catch(error){console.warn('MYON DEV mission save',error);return false}
}
function transact(transform){
 if(!world)return false;
 const next=JSON.parse(JSON.stringify(world));
 transform(next);
 if(!write(next)){notice='저장할 수 없어 변경을 취소했습니다. 저장 공간을 확인하세요.';render();return false}
 world=next;return true;
}
function load(){
 for(const key of [STORE,STORE+'.backup']){
  try{const raw=localStorage.getItem(key);if(!raw)continue;const v=JSON.parse(raw);if(validWorld(v))return v;}
  catch(error){console.warn('MYON DEV mission restore',error)}
 }
 return null;
}
function applyDelta(stats,field,amount){
 stats[field]=round2(Math.min(100,Math.max(0,stats[field]+amount)));
}
function settleDue(){
 if(!world)return;
 const now=Date.now();
 if(!world.active.some(m=>m.endsAt<=now))return;
 const done=[];
 const ok=transact(next=>{
  const active=[];
  for(const m of next.active){
   if(m.endsAt>now){active.push(m);continue}
   const mystery={field:randInt(0,catalog.length-1),amount:bandValue()*(Math.random()<0.5?1:-1)};
   applyDelta(next.stats,m.field,m.direct);
   applyDelta(next.stats,m.plus.field,m.plus.amount);
   applyDelta(next.stats,m.minus.field,m.minus.amount);
   applyDelta(next.stats,mystery.field,mystery.amount);
   next.cash+=m.money;
   const result={...m,mystery,completedAt:now};
   next.history.unshift(result);done.push(result);
  }
  next.active=active;
  next.history=next.history.slice(0,40);
  fillOffers(next);
 });
 if(ok&&done.length){notice=done.length+'건 정산 완료';render()}
}
function begin(id){
 if(!world)return;
 const found=world.offers.find(m=>m.id===id);if(!found)return;
 if(transact(next=>{
  const index=next.offers.findIndex(m=>m.id===id);if(index<0)return;
  const m=next.offers.splice(index,1)[0];
  m.startedAt=Date.now();m.endsAt=m.startedAt+m.durationTicks*1000;
  next.active.push(m);
 })) {notice='임무 수락 · 현실시간으로 진행됩니다.';render()}
}
function restart(){
 if(!window.confirm('새 무작위 도시에서 처음부터 시작할까요?\n현재 자금·임무·분야 수치가 초기화됩니다.'))return;
 const fresh=newWorld();
 try{
  const before=localStorage.getItem(STORE);if(before)localStorage.setItem(STORE+'.backup',before);
 }catch(error){console.warn('MYON DEV city backup',error)}
 if(!write(fresh)){notice='저장할 수 없어 도시를 변경하지 않았습니다.';render();return}
 world=fresh;notice='새 도시에서 시작했습니다.';closeStats();render();
}
function elem(tag,cl,text){
 const e=document.createElement(tag);if(cl)e.className=cl;
 if(text!==undefined)e.textContent=text;return e;
}
function add(parent,tag,cl,text){const e=elem(tag,cl,text);parent.append(e);return e}
function statCell(parent,label,value,cl){
 const cell=add(parent,'div','mw-value');
 add(cell,'span','mw-label',label);add(cell,'strong',cl||'',value);
}
function renderMission(m,active){
 const item=elem('article','mw-card');
 item.dataset.missionId=m.id;
 const top=add(item,'div','mw-card-top');
 const identity=add(top,'div','mw-card-identity');
 add(identity,'span','mw-tag',catalog[m.field].category);
 add(identity,'h3','mw-name',fieldTitle(m.field));
 const controls=add(top,'div','mw-card-controls');
 if(m.grade!=='일반')add(controls,'span','mw-tier mw-special',m.grade);
 add(controls,'span','mw-stage',m.stage+'단계');
 if(active){
  const remaining=Math.max(0,Math.ceil((m.endsAt-Date.now())/1000));
  add(controls,'span','mw-time',hourClock(remaining)+' 남음');
 }else{
  add(controls,'span','mw-time',hourClock(m.durationTicks));
  const button=add(controls,'button','mw-button mw-accept','수락');
  button.type='button';button.addEventListener('click',()=>begin(m.id));
 }
 const grid=add(item,'div','mw-rewards');
 statCell(grid,'금전',fmt(m.money));
 statCell(grid,'기여',signed(m.direct),'mw-positive');
 statCell(grid,'+ · '+fieldTitle(m.plus.field),signed(m.plus.amount),'mw-positive');
 statCell(grid,'− · '+fieldTitle(m.minus.field),signed(m.minus.amount),'mw-negative');
 statCell(grid,'? · 미지','?');
 if(active){
  const foot=add(item,'div','mw-card-bottom');
  const track=add(foot,'div','mw-track');
  const progress=Math.min(100,Math.max(0,((Date.now()-m.startedAt)/(m.durationTicks*1000))*100));
  add(track,'div','mw-fill').style.width=progress+'%';
  add(foot,'span','mw-count',Math.floor(progress)+'%');
 }
 return item;
}
function renderHistory(parent){
 const title=add(parent,'h2','mw-section-title','최근 정산');
 if(!world.history.length){add(parent,'p','mw-muted','아직 완료된 임무가 없습니다.');return}
 for(const m of world.history.slice(0,5)){
  const row=add(parent,'div','mw-history-row');
  add(row,'span','mw-history-title',fieldTitle(m.field));
  const values=add(row,'span','mw-history-reward');
  values.append('+'+fmt(m.money)+' · '+signed(m.direct)+' · '+fieldTitle(m.mystery.field)+' '+signed(m.mystery.amount));
 }
}
function renderStats(parent){
 const contents=add(parent,'div','mw-info-grid');
 const categories=add(contents,'nav','mw-categories');
 categories.setAttribute('aria-label','대분류 선택');
 for(let i=0;i<CATEGORIES_REQUIRED;i++){
  const button=add(categories,'button','mw-category'+(viewCategory===i?' active':''),catalog[i*10].category);
  button.type='button';button.setAttribute('aria-pressed',String(viewCategory===i));
  button.addEventListener('click',()=>{
   viewCategory=i;
   const body=$m('mw-stat-zone');
   body.replaceChildren();renderStats(body);
   const buttons=body.querySelectorAll('.mw-category');
   if(buttons[i])buttons[i].focus({preventScroll:true});
  });
 }
 const fields=add(contents,'section','mw-fields');
 add(fields,'h3','mw-fields-title',catalog[viewCategory*10].category+' · 10개 분야');
 for(const field of catalog.filter(x=>x.categoryIndex===viewCategory)){
  const row=add(fields,'div','mw-stat-row');
  add(row,'span','',field.name);
  add(row,'strong','',two(world.stats[field.id]));
 }
}
function closeStats(){
 showStats=false;
 const modal=$m('mw-stats-modal');
 if(modal)modal.hidden=true;
 const toggle=$m('mw-stats-toggle');
 if(toggle){toggle.setAttribute('aria-expanded','false');toggle.textContent='도시 정보창'}
}
function toggleStats(){
 showStats=!showStats;
 const modal=$m('mw-stats-modal'),toggle=$m('mw-stats-toggle');
 modal.hidden=!showStats;
 toggle.setAttribute('aria-expanded',String(showStats));
 toggle.textContent=showStats?'정보창 닫기':'도시 정보창';
 if(showStats){
  const stats=$m('mw-stat-zone');stats.replaceChildren();renderStats(stats);
  $m('mw-stats-close').focus({preventScroll:true});
 }else toggle.focus({preventScroll:true});
}
function updateProgress(){
 if(!world)return;
 for(const m of world.active){
  const card=$m('mw-active')?.querySelector('[data-mission-id="'+m.id+'"]');
  if(!card)continue;
  const remaining=Math.max(0,Math.ceil((m.endsAt-Date.now())/1000));
  const progress=Math.min(100,Math.max(0,((Date.now()-m.startedAt)/(m.durationTicks*1000))*100));
  const clock=card.querySelector('.mw-time'),fill=card.querySelector('.mw-fill'),count=card.querySelector('.mw-count');
  if(clock)clock.textContent=hourClock(remaining)+' 남음';
  if(fill)fill.style.width=progress+'%';
  if(count)count.textContent=Math.floor(progress)+'%';
 }
}
function render(){
 if(!world)return;
 const root=$m('mw-root');if(!root)return;
 const scroller=$m('mw-scroll');
 const scrollY=scroller?.scrollTop||0;
 const city=cities.find(c=>c.id===world.city);
 $m('mw-city').textContent=city?.name||world.city;
 $m('mw-terrain').textContent=(city?.terrain||CITY_TYPES[world.city].terrain)+' · '+(city?.identity||'');
 $m('mw-cash').textContent=fmt(world.cash);
 $m('mw-notice').textContent=notice;
 $m('mw-stats-toggle').textContent=showStats?'정보창 닫기':'도시 정보창';
 $m('mw-stats-toggle').setAttribute('aria-expanded',String(showStats));
 $m('mw-offer-count').textContent=world.offers.length+'건';
 $m('mw-active-count').textContent=world.active.length+'건';
 const offers=$m('mw-offers');offers.replaceChildren();
 if(world.offers.length)for(const m of world.offers)offers.append(renderMission(m,false));
 else add(offers,'p','mw-muted','진행 중인 임무가 완료되면 새로운 임무가 등장합니다.');
 const active=$m('mw-active');active.replaceChildren();
 if(world.active.length)for(const m of world.active)active.append(renderMission(m,true));
 else add(active,'p','mw-muted','진행 중인 임무가 없습니다.');
 const history=$m('mw-history');history.replaceChildren();renderHistory(history);
 const stats=$m('mw-stat-zone');
 if(showStats){stats.replaceChildren();renderStats(stats)}
 if(scroller)scroller.scrollTop=scrollY;
}
function tick(){
 if($m('mw-root')?.hidden)return;
 settleDue();
 updateProgress();
}
function openGame(){
 if(!world)return;
 currentScreen='missions';
 $m('mw-root').hidden=false;
 $m('dev-notes').hidden=true;
 document.querySelector('.main').hidden=true;
 $m('character').hidden=true;
 $m('arrival').hidden=true;
 $m('welcome').hidden=true;
 $m('city-ambient').hidden=true;
 $m('dev-notes-open').hidden=false;
 $m('back').querySelector('span').textContent='개발노트';
 settleDue();render();
}
function openNotes(){
 closeStats();$m('mw-root').hidden=true;
 showScreen('notes');devNotebookGo([]);loadDevNotes();
}
function setupUi(){
 const parent=document.querySelector('.shell');
 const root=elem('main','mw-root');root.id='mw-root';root.hidden=true;
 root.setAttribute('aria-label','MYON DEV 임무 테스트');
 const head=add(root,'div','mw-head');
 const left=add(head,'div','');
 add(left,'span','mw-eyebrow','MYON WORLD / MISSION TEST');
 add(left,'h1','mw-city','').id='mw-city';
 add(left,'p','mw-terrain','').id='mw-terrain';
 const headerRight=add(head,'div','mw-header-actions');
 const cash=add(headerRight,'div','mw-cash-box');add(cash,'span','mw-label','보유 금전');add(cash,'strong','mw-cash','0').id='mw-cash';
 const toggle=add(headerRight,'button','mw-button','도시 정보창');toggle.type='button';toggle.id='mw-stats-toggle';
 toggle.setAttribute('aria-haspopup','dialog');toggle.setAttribute('aria-expanded','false');
 toggle.addEventListener('click',toggleStats);
 const restartButton=add(headerRight,'button','mw-button mw-restart','새 도시 시작');restartButton.type='button';restartButton.addEventListener('click',restart);
 const scroll=add(root,'div','mw-scroll');scroll.id='mw-scroll';
 add(scroll,'p','mw-notice','').id='mw-notice';
 const section1=add(scroll,'section','mw-section');
 const h1=add(section1,'div','mw-section-head');add(h1,'h2','mw-section-title','이용 가능한 임무');add(h1,'span','mw-small','').id='mw-offer-count';
 add(section1,'div','mw-cards','').id='mw-offers';
 const section2=add(scroll,'section','mw-section');
 const h2=add(section2,'div','mw-section-head');add(h2,'h2','mw-section-title','진행 중');add(h2,'span','mw-small','').id='mw-active-count';
 add(section2,'div','mw-cards','').id='mw-active';
 add(scroll,'section','mw-section','').id='mw-history';
 const modal=add(parent,'div','mw-stats-modal');modal.id='mw-stats-modal';modal.hidden=true;
 const panel=add(modal,'div','mw-stats-panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','mw-stats-title');
 const panelHead=add(panel,'div','mw-modal-head');
 const title=add(panelHead,'h2','mw-section-title','도시 정보창');title.id='mw-stats-title';
 const close=add(panelHead,'button','mw-button','닫기');close.id='mw-stats-close';close.type='button';
 close.addEventListener('click',()=>{closeStats();$m('mw-stats-toggle').focus({preventScroll:true})});
 add(panel,'div','mw-stat-zone').id='mw-stat-zone';
 modal.addEventListener('click',event=>{if(event.target===modal){closeStats();$m('mw-stats-toggle').focus({preventScroll:true})}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&showStats){event.stopImmediatePropagation();closeStats();$m('mw-stats-toggle').focus({preventScroll:true})}},true);
 parent.insertBefore(root,$m('character'));
 $m('dn-start-test').addEventListener('click',e=>{e.stopImmediatePropagation();e.preventDefault();openGame()},true);
 $m('dev-notes-open').addEventListener('click',()=>{root.hidden=true},true);
 $m('back').addEventListener('click',e=>{if(!root.hidden){e.stopImmediatePropagation();e.preventDefault();openNotes()}},true);
 window.resumeDevGame=openGame;
 window.MYON_SAFE_UPDATE_CHECKPOINT=async()=>world?write(world):true;
}
async function bootstrap(){
 try{
  const response=await fetch('./myon-world-baseline.json',{cache:'no-store'});
  if(!response.ok)throw Error('자료 로딩 실패 ('+response.status+')');
  const data=await response.json();
  if(!Array.isArray(data.domains)||data.domains.length!==CATEGORIES_REQUIRED||
     data.domains.some(d=>!Array.isArray(d.scope)||d.scope.length!==10))throw Error('150개 분야 데이터가 완성되지 않았습니다.');
  catalog=data.domains.flatMap((d,categoryIndex)=>d.scope.map((name,i)=>({id:categoryIndex*10+i,name,category:d.name,categoryIndex})));
  cities=data.cities.filter(c=>CITY_TYPES[c.id]);
  if(catalog.length!==DOMAINS_REQUIRED||!cities.length)throw Error('도시 및 분야 개수 검증 실패');
  world=load()||newWorld();
  if(!write(world))throw Error('DEV 저장소를 사용할 수 없습니다.');
  setupUi();
  window.setInterval(tick,1000);
 }catch(error){
  console.error('MYON DEV mission start failed:',error);
  const button=$m('dn-start-test');
  if(button){button.disabled=true;button.textContent='게임 테스트 준비 실패';button.title=String(error.message||error);}
 }
}
bootstrap();
})();