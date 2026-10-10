/** MYON v0.01: city mission engine. All durations are real elapsed time. */
import { isValidGame as isValidLegacyGame } from './legacyEngine.js'
export const GAME_VERSION = '0.01'
export const SAVE_SCHEMA = 5
export const MAX_ACTIVE_MISSIONS = 2
export const OFFER_COUNT = 5
const clone = value => JSON.parse(JSON.stringify(value))
const validTime = n => Number.isSafeInteger(n) && n >= 0
const validAmount = n => Number.isSafeInteger(n) && n >= 0
const nextSeed = value => {let x=value>>>0 || 0x6d2b79f5;x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0 || 1}
const templates = [
 // 제목, 총 수행비용, 시 선부담, 순이익, 수행초 (0원으로 시작 가능한 임무 포함)
 ['도시 안내문 배포',200,200,800,50],
 ['거리 환경 정비',300,300,1000,65],
 ['지역 주민 설문 조사',250,250,900,50],
 ['공공 행사 안내 지원',500,500,1300,85],
 ['대중교통 이용 실태 조사',400,400,1100,70],
 ['야간 안전 점검',650,650,1600,90],
 ['공원 시설 순찰',420,420,1050,65],
 ['소규모 행사 물품 운반',900,750,1900,105],
 ['시내 긴급 서류 배송',850,650,2100,115],
 ['택시 승객 운송 지원',1200,900,2800,130],
 ['버스 정류소 정비',1700,1200,3700,160],
 ['시내 도로 안내 표지 교체',2200,1300,4200,165],
 ['문화 행사 시설 설치',2800,1700,5100,170],
 ['공영 주차장 환경 개선',3100,1800,6000,200],
 ['지역 상권 배송 지원',2600,1600,4800,155],
 ['산업단지 화물 운송',4600,2000,7400,240],
 ['시내 버스 임시 노선 운영',5500,3000,9000,275],
 ['철도역 시설 유지보수',7500,3700,12000,320],
 ['도시 통신 설비 점검',6200,3000,10500,260],
 ['하천 정화 사업',8500,4000,14000,300],
 ['지역 축제 종합 운영',12500,5000,18500,355],
 ['공항 셔틀 수송 지원',18000,8000,25000,400],
 ['해상 물자 하역 지원',24000,10500,32000,445],
 ['광역 버스 임시 운행',30000,12000,41000,480],
 ['철도 차량 정비 사업',55000,20000,69000,520],
 ['공항 시설 개선 사업',80000,30000,100000,640],
 ['항만 물류 지원 사업',95000,35000,120000,720],
 ['도시 복합교통 시설 개선',135000,40000,165000,840],
]
const starterCount = 7
function roll(g, min, max){g.missions.seed=nextSeed(g.missions.seed);return min+g.missions.seed%(max-min+1)}
function addLog(g, at, text){g.logs.unshift({at,message:text});if(g.logs.length>50)g.logs.length=50}
const freshMissions = seed => ({seed:nextSeed(seed),sequence:0,offers:[],active:[],history:[]})
export function createInitialGame(now=Date.now(), seed=Math.floor(Math.random()*0xffffffff)){
 const citySeed=seed>>>0||42
 return {schemaVersion:SAVE_SCHEMA,gameVersion:GAME_VERSION,createdAt:now,updatedAt:now,
  city:{name:'',seed:citySeed},phase:'intro',company:null,
  economy:{balance:0,currency:'M',gross:0,spent:0},missions:freshMissions(citySeed),logs:[]}
}
function validMission(m, active=false){
 if(!m||!Number.isSafeInteger(m.id)||m.id<1||typeof m.title!=='string'||m.title.length<1||m.title.length>70||
  ![m.cost,m.cityShare,m.companyCost,m.reward,m.companyProfit,m.durationSeconds].every(validAmount)||
  m.cityShare+m.companyCost!==m.cost||m.reward<m.cost||m.companyProfit!==Math.floor((m.reward-m.cost)*0.1)||
  m.durationSeconds<10||m.durationSeconds>86400||!validTime(m.offeredAt)||!validTime(m.expiresAt)||m.expiresAt<=m.offeredAt) return false
 if(active&&(!validTime(m.startedAt)||!validTime(m.endsAt)||m.endsAt!==m.startedAt+m.durationSeconds*1000))return false
 return true
}
export function isValidGame(g){
 if(!g||g.schemaVersion!==SAVE_SCHEMA||g.gameVersion!==GAME_VERSION||!validTime(g.createdAt)||!validTime(g.updatedAt)||
   !g.city||typeof g.city.name!=='string'||g.city.name.length>40||!Number.isInteger(g.city.seed)||
   !['intro','ready'].includes(g.phase)||(g.phase==='intro'&&g.city.name!=='')||(g.phase==='ready'&&!g.city.name.trim())||
   !(g.company===null||(typeof g.company?.name==='string'&&!!g.company.name.trim()&&g.company.name.length<=40&&validTime(g.company.acquiredAt)&&typeof g.company.welcomed==='boolean'))||
   (g.company&&g.phase!=='ready')||!g.economy||g.economy.currency!=='M'||!['balance','gross','spent'].every(k=>validAmount(g.economy[k]))||
   !g.missions||!Number.isInteger(g.missions.seed)||!Number.isSafeInteger(g.missions.sequence)||g.missions.sequence<0||
   !Array.isArray(g.missions.offers)||g.missions.offers.length>OFFER_COUNT||!Array.isArray(g.missions.active)||g.missions.active.length>MAX_ACTIVE_MISSIONS||
   !Array.isArray(g.missions.history)||!Array.isArray(g.logs)||g.logs.length>50||
   (g.phase==='intro'&&(g.company!==null||g.missions.offers.length||g.missions.active.length))||
   (!g.company&&(g.missions.offers.length||g.missions.active.length)))return false
 const ids=new Set()
 for(const m of [...g.missions.offers,...g.missions.active]){
  if(!validMission(m,g.missions.active.includes(m))||ids.has(m.id)||m.id>g.missions.sequence)return false
  ids.add(m.id)
 }
 // The full history is deliberately retained in the save file.
 return true
}
const ensure = g => {if(!isValidGame(g))throw new Error('저장 데이터가 올바르지 않습니다.')}
function newOffer(g,at,forceStarter=false){
 const blocked=new Set([...g.missions.offers,...g.missions.active].map(m=>m.title))
 let pool=forceStarter?templates.slice(0,starterCount):templates
 const available=pool.filter(t=>!blocked.has(t[0]))
 if(available.length)pool=available
 const t=pool[roll(g,0,pool.length-1)]
 const cost=t[1],cityShare=t[2],reward=cost+t[3]
 return {id:++g.missions.sequence,title:t[0],cost,cityShare,companyCost:cost-cityShare,
  reward,companyProfit:Math.floor((reward-cost)*0.1),durationSeconds:t[4],
  offeredAt:at,expiresAt:at+roll(g,90,240)*1000}
}
function topUpOffers(g,at){
 while(g.missions.offers.length<OFFER_COUNT){
  const ensureFree=!g.missions.offers.some(m=>m.companyCost<=g.economy.balance)
  g.missions.offers.push(newOffer(g,at,ensureFree))
 }
}
export function startGame(g,name,at=Date.now()){
 ensure(g)
 if(g.phase!=='intro')throw new Error('게임은 이미 시작되었습니다.')
 const city=String(name??'').trim();if(!city||city.length>40)throw new Error('도시 이름을 1~40자로 입력해 주세요.')
 const next=clone(g);next.city.name=city;next.phase='ready';next.updatedAt=at
 return next
}
export function establishCompany(g,name,at=Date.now()){
 ensure(g)
 if(g.phase!=='ready'||g.company)throw new Error('회사가 이미 등록되어 있습니다.')
 const title=String(name??'').trim();if(!title||title.length>40)throw new Error('회사 이름을 1~40자로 입력해 주세요.')
 const next=clone(g);next.company={name:title,acquiredAt:at,welcomed:true};next.updatedAt=at
 topUpOffers(next,at);addLog(next,at,`${title} 설립`);return next
}
export function acceptMission(g,id,at=Date.now()){
 ensure(g)
 if(!g.company)throw new Error('회사 이름을 먼저 정해 주세요.')
 if(g.missions.active.length>=MAX_ACTIVE_MISSIONS)throw new Error('동시에 최대 2개 임무만 수행할 수 있습니다.')
 const offer=g.missions.offers.find(m=>m.id===id)
 if(!offer||offer.expiresAt<=at)throw new Error('수락 기한이 지난 임무입니다.')
 if(g.economy.balance<offer.companyCost)throw new Error('회사 수락 비용이 부족합니다.')
 const next=clone(g),m=next.missions.offers.find(x=>x.id===id)
 next.missions.offers=next.missions.offers.filter(x=>x.id!==id)
 next.economy.balance-=m.companyCost;next.economy.spent+=m.companyCost
 next.missions.active.push({...m,startedAt:at,endsAt:at+m.durationSeconds*1000})
 topUpOffers(next,at);next.updatedAt=at;addLog(next,at,`${m.title} 임무 수락`)
 return next
}
export function advanceWorld(g,at=Date.now()){
 ensure(g)
 if(!g.company)return {game:g,changed:false,completed:[],expired:0,earned:0}
 const next=clone(g),completed=[]
 let expired=0
 next.missions.offers=next.missions.offers.filter(m=>{if(m.expiresAt>at)return true;expired++;return false})
 const remaining=[]
 for(const m of next.missions.active){
  if(m.endsAt>at){remaining.push(m);continue}
  // The company pays its part upfront, and receives the advance back with its profit at completion.
  const depositReturn=m.companyCost+m.companyProfit
  next.economy.balance+=depositReturn;next.economy.gross+=depositReturn
  const completedEntry={id:m.id,title:m.title,completedAt:m.endsAt,cost:m.cost,cityShare:m.cityShare,
    companyCost:m.companyCost,reward:m.reward,companyProfit:m.companyProfit}
  next.missions.history.unshift(completedEntry);completed.push(completedEntry)
  addLog(next,m.endsAt,`${m.title} 완료 · 회사 수익 +${m.companyProfit.toLocaleString('ko-KR')} M`)
 }
 next.missions.active=remaining
 const before=next.missions.offers.length
 topUpOffers(next,at)
 const changed=expired>0||completed.length>0||next.missions.offers.length!==before
 if(!changed)return {game:g,changed:false,completed:[],expired:0,earned:0}
 next.updatedAt=at
 return {game:next,changed:true,completed,expired,earned:completed.reduce((s,m)=>s+m.companyProfit,0)}
}
export function renameCompany(g,name,at=Date.now()){
 ensure(g);if(!g.company)throw new Error('먼저 회사를 설립해 주세요.')
 const title=String(name??'').trim();if(!title||title.length>40)throw new Error('회사 이름을 1~40자로 입력해 주세요.')
 const next=clone(g);next.company.name=title;next.updatedAt=at;return next
}
/** Migrates only valid old 0.01 saves. Old taxi data stays archived, not active. */
export function normalizeImport(input,at=Date.now()){
 if(isValidGame(input))return clone(input)
 if(isValidLegacyGame(input)){
  const next=createInitialGame(input.createdAt,input.city.seed)
  next.phase=input.phase;next.city=clone(input.city);next.company=clone(input.company);next.economy=clone(input.economy)
  next.updatedAt=at
  next.legacyTransport={taxis:clone(input.taxis),stats:clone(input.stats),history:clone(input.history),logs:clone(input.logs)}
  next.logs=[{at,message:'이전 운행 자료 보존 · 도시 임무 시스템 적용'}]
  if(next.company)topUpOffers(next,at)
  return next
 }
 throw new Error('MYON 저장 형식이 올바르지 않습니다.')
}
