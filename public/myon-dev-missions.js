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
const INITIAL_OFFERS=4,MAX_WAITING_OFFERS=10,OFFER_INTERVAL_MS=600000,OFFER_LIFETIME_MS=3600000;
const $m=id=>document.getElementById(id);
let catalog=[],cities=[],world=null,cityNameData=null,notice='';
const randInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
const round2=n=>Math.round((n+Number.EPSILON)*100)/100;
const fmt=n=>Number(n).toLocaleString('ko-KR');
const two=n=>Number(n).toFixed(2);
const signed=n=>(n>=0?'+':'−')+two(Math.abs(n));
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
function generateMission(state,createdAt=Date.now(),free=false){
 const field=randInt(0,catalog.length-1),entry=catalog[field],score=state.stats[field];
 const r=Math.random()*100,grade=r<94?'일반':r<99?'극한':'리얼';
 const minutes=grade==='일반'?randInt(30,180):grade==='극한'?randInt(180,360):randInt(360,1440);
 const bonus=grade==='극한'?10000:grade==='리얼'?50000:0;
 const fit=profile(state.city,entry.categoryIndex,entry.name);
 const direct=Math.max(0.01,round2(bandValue()*fit));
 const plus={field:randInt(0,catalog.length-1),amount:bandValue()};
 const minus={field:randInt(0,catalog.length-1),amount:-bandValue()};
 return {id:'m'+createdAt.toString(36)+Math.random().toString(36).slice(2,10),
  field,stage:stage(score),grade,minutes,durationTicks:minutes*60,money:minutes*100+bonus,
  acceptCost:free?0:minutes,direct,plus,minus,createdAt,expiresAt:createdAt+OFFER_LIFETIME_MS};
}
function ensureFreeRecovery(state){
 // Missing all starter offers must not block a zero-money player permanently.
 if(state.cash===0&&state.active.length===0&&state.offers.length&&!state.offers.some(m=>m.acceptCost===0))
  state.offers[0].acceptCost=0;
}
function refreshOffers(){
 if(!world)return false;
 const now=Date.now();
 if(now<world.nextOfferAt&&!world.offers.some(m=>m.expiresAt<=now))return false;
 const ok=transact(next=>{
  next.offers=next.offers.filter(m=>m.expiresAt>now);
  let scheduled=next.nextOfferAt;
  if(scheduled<now-OFFER_LIFETIME_MS)
   scheduled+=Math.ceil((now-OFFER_LIFETIME_MS-scheduled)/OFFER_INTERVAL_MS)*OFFER_INTERVAL_MS;
  for(;scheduled<=now;scheduled+=OFFER_INTERVAL_MS){
   if(next.offers.length<MAX_WAITING_OFFERS)next.offers.push(generateMission(next,scheduled));
  }
  next.offers=next.offers.filter(m=>m.expiresAt>now);
  if(now>=next.nextOfferAt)
   next.nextOfferAt+=(Math.floor((now-next.nextOfferAt)/OFFER_INTERVAL_MS)+1)*OFFER_INTERVAL_MS;
  ensureFreeRecovery(next);
 });
 if(ok)render();
 return ok;
}
function createCityName(city){
 if(!cityNameData)return cities.find(c=>c.id===city)?.name||city;
 return choose(cityNameData.prefixes)+choose(cityNameData.roots)+choose(cityNameData.endings[city]);
}
function newWorld(){
 const city=choose(cities).id,cityName=createCityName(city);
 const createdAt=Date.now();
 const next={schema:1,city,cityName,createdAt,cash:0,stats:initialStats(city),offers:[],active:[],history:[],nextOfferAt:createdAt+OFFER_INTERVAL_MS};
 for(let i=0;i<INITIAL_OFFERS;i++)next.offers.push(generateMission(next,createdAt,true));
 return next;
}
function validWorld(v){
 return !!(v&&v.schema===1&&CITY_TYPES[v.city]&&(v.cityName===undefined||(typeof v.cityName==='string'&&v.cityName.length>=2&&v.cityName.length<=24))&&Array.isArray(v.stats)&&v.stats.length===DOMAINS_REQUIRED&&v.stats.every(n=>Number.isFinite(n)&&n>=0&&n<=100)
  &&Number.isSafeInteger(v.cash)&&v.cash>=0&&Array.isArray(v.offers)&&Array.isArray(v.active)&&Array.isArray(v.history)
  &&v.offers.length<=MAX_WAITING_OFFERS&&Number.isSafeInteger(v.nextOfferAt)&&v.nextOfferAt>0&&[...v.offers,...v.active].every(m=>m&&Number.isSafeInteger(m.durationTicks)&&m.durationTicks>=1800
    &&Number.isSafeInteger(m.field)&&m.field>=0&&m.field<DOMAINS_REQUIRED&&Number.isSafeInteger(m.money)
     &&Number.isSafeInteger(m.acceptCost)&&m.acceptCost>=0)
   &&v.offers.every(m=>Number.isSafeInteger(m.createdAt)&&m.expiresAt===m.createdAt+OFFER_LIFETIME_MS)
   &&v.active.every(m=>Number.isSafeInteger(m.startedAt)&&m.endsAt===m.startedAt+m.durationTicks*1000));
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
window.MYON_SAFE_UPDATE_CHECKPOINT=async function(){
 if(!world)return true; // No numeric world exists yet.
 if(!write(world))return false;
 try{
  const saved=localStorage.getItem(STORE);
  return saved===JSON.stringify(world)&&validWorld(JSON.parse(saved));
 }catch(error){console.warn('MYON DEV exit checkpoint',error);return false}
};
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

 });
 if(ok&&done.length){notice=done.length+'건 정산 완료';render()}
}
function begin(id){
 if(!world)return;
 const m=world.offers.find(m=>m.id===id);if(!m)return;
 if(m.expiresAt<=Date.now()){refreshOffers();return}
 if(m.acceptCost>world.cash){notice='자금 부족 · 수락 비용 '+fmt(m.acceptCost)+' M';render();return}
 if(transact(next=>{
  const index=next.offers.findIndex(x=>x.id===id);if(index<0)return;
  const task=next.offers.splice(index,1)[0];
  next.cash-=task.acceptCost;
  task.startedAt=Date.now();task.endsAt=task.startedAt+task.durationTicks*1000;
  next.active.push(task);
 })) {notice='임무 수락 · '+fmt(m.acceptCost)+' M 차감';render()}
}
function elem(tag,cl,text){
 const e=document.createElement(tag);if(cl)e.className=cl;
 if(text!==undefined)e.textContent=text;return e;
}
function add(parent,tag,cl,text){const e=elem(tag,cl,text);parent.append(e);return e}
function statCell(parent,label,value,cl,unit){
 const cell=add(parent,'div','mw-value');
 add(cell,'span','mw-label',label);
 add(cell,'strong',cl||'',value);
 if(unit)add(cell,'small','mw-unit',unit);
}
function renderMission(m,active){
 const item=elem('article','mw-card');item.dataset.missionId=m.id;
 const top=add(item,'div','mw-card-top'),identity=add(top,'div','mw-card-identity');
 add(identity,'span','mw-tag',catalog[m.field].category);
 add(identity,'h3','mw-name',fieldTitle(m.field));
 if(!active){
  const controls=add(top,'div','mw-card-controls');
  const button=add(controls,'button','mw-button mw-accept','수락');
  button.type='button';button.addEventListener('click',()=>begin(m.id));
 }
 const grid=add(item,'div','mw-rewards');
 statCell(grid,'수락',fmt(m.acceptCost),'mw-cost','M');
 statCell(grid,'보상',fmt(m.money),'','M');
 statCell(grid,'기여',signed(m.direct),'mw-positive');
 statCell(grid,'+변수',signed(m.plus.amount),'mw-positive');
 statCell(grid,'−변수',signed(m.minus.amount),'mw-negative');
 const foot=add(item,'div','mw-card-bottom');
 const track=add(foot,'div','mw-track'+(active?'':' mw-expire-track'));
 const progress=active
  ?Math.min(100,Math.max(0,((Date.now()-m.startedAt)/(m.durationTicks*1000))*100))
  :Math.min(100,Math.max(0,((Date.now()-m.createdAt)/OFFER_LIFETIME_MS)*100));
 add(track,'div','mw-fill'+(active?'':' mw-expire-fill')).style.width=progress+'%';
 if(active)add(foot,'span','mw-count',Math.floor(progress)+'%');
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
function updateProgress(){
 if(!world)return;
 for(const m of world.active){
  const card=$m('mw-active')?.querySelector('[data-mission-id="'+m.id+'"]');
  if(!card)continue;
  const progress=Math.min(100,Math.max(0,((Date.now()-m.startedAt)/(m.durationTicks*1000))*100));
  const fill=card.querySelector('.mw-fill'),count=card.querySelector('.mw-count');
  if(fill)fill.style.width=progress+'%';
  if(count)count.textContent=Math.floor(progress)+'%';
 }
 for(const m of world.offers){
  const card=$m('mw-offers')?.querySelector('[data-mission-id="'+m.id+'"]');
  const fill=card?.querySelector('.mw-expire-fill');
  if(fill)fill.style.width=Math.min(100,Math.max(0,((Date.now()-m.createdAt)/OFFER_LIFETIME_MS)*100))+'%';
 }
}
function render(){
 if(!world)return;
 const root=$m('mw-root');if(!root)return;
 const scroller=$m('mw-scroll');
 const scrollY=scroller?.scrollTop||0;
 $m('mw-cash').textContent=fmt(world.cash);
 $m('mw-notice').textContent=notice;

 $m('mw-offer-count').textContent=world.offers.length+'건';
 $m('mw-active-count').textContent=world.active.length+'건';
 const offers=$m('mw-offers');offers.replaceChildren();
 if(world.offers.length)for(const m of world.offers)offers.append(renderMission(m,false));
 else add(offers,'p','mw-muted','다음 10분 주기에 새로운 임무가 등장합니다.');
 const active=$m('mw-active');active.replaceChildren();
 if(world.active.length)for(const m of world.active)active.append(renderMission(m,true));
 else add(active,'p','mw-muted','진행 중인 임무가 없습니다.');
 const history=$m('mw-history');history.replaceChildren();renderHistory(history);
 if(scroller)scroller.scrollTop=scrollY;
}
function tick(){
 if($m('mw-root')?.hidden)return;
 settleDue();
 refreshOffers();
 updateProgress();
}
function openGame(){
 if(!world)return;
 currentScreen='missions';
 $m('mw-root').hidden=false;
 $m('mw-money-strip').hidden=false;
 document.querySelector('.main').hidden=true;
 $m('character').hidden=true;
 $m('arrival').hidden=true;
 $m('welcome').hidden=true;
 $m('city-ambient').hidden=true;
 $m('back').querySelector('span').textContent='시작화면';
 settleDue();refreshOffers();render();
}
function setupUi(){
 const parent=document.querySelector('.shell');
 const root=elem('main','mw-root');root.id='mw-root';root.hidden=true;
 root.setAttribute('aria-label','MYON DEV 임무 테스트');

 const scroll=add(root,'div','mw-scroll');scroll.id='mw-scroll';
 add(scroll,'p','mw-notice','').id='mw-notice';
 const section1=add(scroll,'section','mw-section');
 const h1=add(section1,'div','mw-section-head');add(h1,'h2','mw-section-title','이용 가능한 임무');add(h1,'span','mw-small','').id='mw-offer-count';
 add(section1,'div','mw-cards','').id='mw-offers';
 const section2=add(scroll,'section','mw-section');
 const h2=add(section2,'div','mw-section-head');add(h2,'h2','mw-section-title','진행 중');add(h2,'span','mw-small','').id='mw-active-count';
 add(section2,'div','mw-cards','').id='mw-active';
 add(scroll,'section','mw-section','').id='mw-history';
 parent.insertBefore(root,$m('character'));

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
  const responseNames=await fetch('./myon-city-names.json',{cache:'no-store'});
  if(!responseNames.ok)throw Error('도시 이름 자료 로드 실패');
  const names=await responseNames.json();
  if(names?.schema!==1||!Array.isArray(names.prefixes)||!names.prefixes.length||
     !Array.isArray(names.roots)||!names.roots.length||!names.endings||
     cities.some(c=>!Array.isArray(names.endings[c.id])||!names.endings[c.id].length)||
     [...names.prefixes,...names.roots,...cities.flatMap(c=>names.endings[c.id])].some(s=>typeof s!=='string'||!s||s.length>12))
     throw Error('도시 이름 자료 형식 오류');
  cityNameData=names;
  world=load()||newWorld();
  if(!write(world))throw Error('DEV 저장소를 사용할 수 없습니다.');
  setupUi();
  openGame();
  window.setInterval(tick,1000);
 }catch(error){
  console.error('MYON DEV mission start failed:',error);
  const fallback=$m('welcome');
  if(fallback){fallback.hidden=false;fallback.textContent='게임 시작 실패 · '+String(error.message||error);}
 }
}
bootstrap();
})();