// MYON TEST one-visit retirement. The original TEST save is never modified.
import {readGameRecords,createEntryCheckpoint,TEST_RELEASE} from './myon-server-entry.mjs'
// Historical TEST retirement backups retain the last approved LIVE baseline marker.
// This is not the playable LIVE target; new gameplay always follows main's latest release.
const TEST_RETIREMENT_LIVE_BASELINE='6496add1137930e867f5534e4edd07684384f646'

export const TEST_RETIREMENT_KEY='MYON_TEST_RETIREMENT_V1'
export const TEST_RETIREMENT_MARKER='v0141-test-funds-credit'
export const TEST_RETIREMENT_DAYS=7
const LIVE_MISSION='MYON_LIVE_MISSIONS_V1',TEST_MISSION='MYON_TEST_MISSIONS_V1'
const FUNDS_KEY='v01322-common-funds',LEDGER_KEY='v01324-finance-ledger'
const TARGET_DB='myon-v00804-progress',STORE='game'
const CREDIT_TAG='myon-test-retirement-2026-v1'
const DAY=86400000
const validUnits=n=>Number.isSafeInteger(n)&&n>=0
function clone(value){return JSON.parse(JSON.stringify(value))}
function parseMission(raw,label){
 if(raw===null)return null
 let value
 try{value=JSON.parse(raw)}catch{throw Error(label+' 세이브 JSON이 손상되었습니다.')}
 if(!value||value.schema!==1||!validUnits(value.cash)||!Array.isArray(value.stats)||
   value.stats.length!==150||!Array.isArray(value.active)||!Array.isArray(value.offers)||
   !Array.isArray(value.history)||!Number.isSafeInteger(value.nextOfferAt))
  throw Error(label+' 자금 기록을 검증할 수 없습니다.')
 return value
}
function parseClaim(storage){
 const raw=storage.getItem(TEST_RETIREMENT_KEY)
 if(raw===null)return null
 let value
 try{value=JSON.parse(raw)}catch{throw Error('가속 서버 1회 접속 기록이 손상되어 접속을 차단했습니다.')}
 if(!value||value.schema!==1||!['pending','complete'].includes(value.phase)||
   !validUnits(value.missionCash)||!validUnits(value.fundsUnits)||
   !Number.isSafeInteger(value.claimedAt)||value.claimedAt<=0)
  throw Error('가속 서버 접속 기록을 검증할 수 없어 접속을 차단했습니다.')
 return value
}
export function readTestRetirement(storage=globalThis.localStorage){
 return parseClaim(storage)
}
export function validSunset(value){
 return !!(value&&value.schema===1&&Number.isSafeInteger(value.startedAt)&&
   Number.isSafeInteger(value.endsAt)&&value.startedAt>0&&
   value.endsAt-value.startedAt===TEST_RETIREMENT_DAYS*DAY)
}
function writeClaim(storage,value){
 const json=JSON.stringify(value)
 storage.setItem(TEST_RETIREMENT_KEY,json)
 if(storage.getItem(TEST_RETIREMENT_KEY)!==json)
  throw Error('가속 서버 접속 차단 기록을 저장하지 못했습니다.')
}
async function creditMission(storage,claim){
 const original=storage.getItem(LIVE_MISSION)
 let saved=parseMission(original,'정식 서버')
 if(!saved){
  // A new LIVE player has no mission record: start with a valid blank world.
  const now=Date.now()
  saved={schema:1,city:'lien',cityName:'리엔시',createdAt:now,cash:0,
   stats:Array(150).fill(50),offers:[],active:[],history:[],nextOfferAt:now+600000}
 }
 const prior=saved.testRetirementCredit
 if(prior){
  if(prior.tag!==CREDIT_TAG||prior.amount!==claim.missionCash)
   throw Error('정식 서버의 기존 이전 기록이 일치하지 않습니다.')
  return
 }
 const nextCash=saved.cash+claim.missionCash
 if(!validUnits(nextCash))throw Error('정식 서버 합산 자금이 안전한 정수 범위를 초과합니다.')
 saved=clone(saved)
 saved.cash=nextCash
 saved.testRetirementCredit={tag:CREDIT_TAG,amount:claim.missionCash,at:claim.claimedAt}
 const json=JSON.stringify(saved)
 storage.setItem(LIVE_MISSION,json)
 if(storage.getItem(LIVE_MISSION)!==json)
  throw Error('정식 서버 임무 자금 저장 확인에 실패했습니다.')
}
function openLiveDatabase(idb){
 return new Promise((resolve,reject)=>{
  let request
  try{request=idb.open(TARGET_DB,1)}catch(error){reject(error);return}
  request.onupgradeneeded=()=>{
   if(!request.result.objectStoreNames.contains(STORE))
    request.result.createObjectStore(STORE)
  }
  request.onerror=()=>reject(request.error||Error('정식 자금 저장소 열기 실패'))
  request.onblocked=()=>reject(Error('다른 게임 탭이 저장소를 사용 중입니다.'))
  request.onsuccess=()=>resolve(request.result)
 })
}
async function creditCommonFunds(idb,claim){
 const db=await openLiveDatabase(idb)
 try{
  return await new Promise((resolve,reject)=>{
   let reason=null,settled=false
   const fail=message=>{
    reason=Error(message)
    try{tx.abort()}catch{}
   }
   let tx
   try{tx=db.transaction(STORE,'readwrite')}catch(e){reject(e);return}
   const store=tx.objectStore(STORE)
   const markerReq=store.get(TEST_RETIREMENT_MARKER)
   const fundsReq=store.get(FUNDS_KEY)
   const ledgerReq=store.get(LEDGER_KEY)
   let count=0
   const check=()=>{
    if(++count!==3)return
    const marker=markerReq.result,old=fundsReq.result,ledger=ledgerReq.result
    if(marker){
     if(marker.tag!==CREDIT_TAG||marker.amount!==claim.fundsUnits)
      return fail('정식 자금의 이전 완료 기록이 일치하지 않습니다.')
     return
    }
    if(old&&(!old||old.schema!==1||!validUnits(old.balance)))
     return fail('정식 공용자금 원본이 손상되었습니다.')
    if(!old&&ledger)return fail('정식 공용자금 원본이 없지만 장부가 존재합니다.')
    const current=old?.balance||0,next=current+claim.fundsUnits
    if(!validUnits(next))return fail('공용자금 합산이 안전한 정수 범위를 초과합니다.')
    store.put({...old,schema:1,balance:next},FUNDS_KEY)
    store.put({schema:1,tag:CREDIT_TAG,amount:claim.fundsUnits,at:claim.claimedAt},TEST_RETIREMENT_MARKER)
   }
   for(const req of [markerReq,fundsReq,ledgerReq])req.onsuccess=check
   tx.oncomplete=()=>{settled=true;resolve()}
   tx.onerror=()=>{if(!settled){settled=true;reject(reason||tx.error||Error('공용자금 저장 실패'))}}
   tx.onabort=()=>{if(!settled){settled=true;reject(reason||tx.error||Error('공용자금 합산 중단'))}}
  })
 }finally{db.close()}
}
async function perform(storage,idb,claim){
 await creditMission(storage,claim)
 await creditCommonFunds(idb,claim)
 const complete={...claim,phase:'complete',completedAt:Date.now()}
 writeClaim(storage,complete)
 return complete
}
async function begin({storage,idb,deadline,now}){
 let claim=parseClaim(storage)
 if(claim?.phase==='complete')return claim
 if(!claim){
  if(!Number.isSafeInteger(deadline)||now>=deadline)
   throw Error('가속 서버 전환 기한이 종료되었습니다.')
  // Both copies are verified before marking the single TEST entry consumed.
  const testRecords=await readGameRecords(idb,'test')
  const funds=testRecords.find(x=>x.key===FUNDS_KEY)?.value
  if(funds&&(!funds||funds.schema!==1||!validUnits(funds.balance)))
   throw Error('가속 서버 공용자금 기록이 손상되었습니다.')
  const source=parseMission(storage.getItem(TEST_MISSION),'가속 서버')
  if(!source&&!funds)throw Error('이 기기에 가속 서버 자금 세이브가 없습니다.')
  await createEntryCheckpoint({idb,storage,server:'test',revision:TEST_RELEASE.revision})
  await createEntryCheckpoint({idb,storage,server:'live',revision:TEST_RETIREMENT_LIVE_BASELINE})
  claim={schema:1,phase:'pending',claimedAt:now,missionCash:source?.cash||0,
   fundsUnits:funds?.balance||0}
  writeClaim(storage,claim) // From here TEST is permanently inaccessible on this browser.
 }
 return perform(storage,idb,claim)
}
export async function retireTestOnce({
 storage=globalThis.localStorage,idb=globalThis.indexedDB,
 deadline,now=Date.now(),locks=globalThis.navigator?.locks
}={}){
 if(!locks?.request)throw Error('안전한 단일 접속 잠금을 지원하는 브라우저가 필요합니다.')
 return locks.request('myon-test-retirement-v1',{mode:'exclusive'},
  ()=>begin({storage,idb,deadline,now:Date.now()}))
}
