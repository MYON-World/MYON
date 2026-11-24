// Independent server routing and verified, on-device pre-entry snapshots.
// Nothing here writes to a player's game database.
import {validReleases,validRevision} from './myon-release-state.mjs'

// The official LIVE release is always the newest deployed main commit.
// The retired TEST release stays pinned for backup/retirement compatibility.
export const TEST_RELEASE=Object.freeze({
 revision:'a3c93e3b4931af3488a6bc5fb15022b17513f451',
 version:'0.13.94'
})
export const GAME_DB=Object.freeze({
 live:'myon-v00804-progress',
 test:'myon-v00804-progress-test',
 dev:'myon-v00804-progress-dev'
})
export const MISSION_SAVE_KEYS=Object.freeze({live:'MYON_LIVE_MISSIONS_V1',test:'MYON_TEST_MISSIONS_V1'})
export const BACKUP_DB='myon-entry-backups-v1'
const STORE='game',BACKUP_STORE='snapshots'

export function targetForServer(server,releases){
 if(server==='live'){
  if(!validReleases(releases))throw Error('정식 서버의 배포 목록을 확인할 수 없습니다.')
  return releases[releases.length-1]
 }
 if(server==='test')return TEST_RELEASE
 if(server==='dev'){
  if(!validReleases(releases))throw Error('개발 서버의 배포 목록을 확인할 수 없습니다.')
  return releases[releases.length-1]
 }
 throw Error('알 수 없는 서버입니다.')
}
export function dbForServer(server){
 if(!Object.prototype.hasOwnProperty.call(GAME_DB,server))throw Error('알 수 없는 서버입니다.')
 return GAME_DB[server]
}
export function archiveUrl(base,server,revision){
 if(!validRevision(revision))throw Error('배포 파일 버전이 올바르지 않습니다.')
 dbForServer(server)
 const root=String(base).replace(/\/?$/,'/')
 return root+'releases/'+revision+'/myon.html?build='+encodeURIComponent(revision)+'&server='+server
}
export async function verifyArchive({base,server,revision,request=fetch}){
 const url=archiveUrl(base,server,revision)
 const response=await request(url,{method:'HEAD',cache:'no-store'})
 if(!response.ok)throw Error('게임 파일을 불러올 수 없습니다. 기존 세이브는 유지됩니다.')
 return url
}
export function readGameRecords(idb,server){
 const dbName=dbForServer(server)
 return new Promise((resolve,reject)=>{
  if(!idb?.open){reject(Error('브라우저 저장소를 사용할 수 없습니다.'));return}
  let created=false,req
  try{req=idb.open(dbName)}catch(error){reject(error);return}
  // Never create an empty GAME database while merely checking for existing saves.
  req.onupgradeneeded=()=>{created=true;req.transaction.abort()}
  req.onerror=()=>{
   if(created)resolve([]) // Aborted creation proves this server has no prior database.
   else reject(req.error||Error('기존 세이브를 열 수 없습니다.'))
  }
  req.onsuccess=()=>{
   const db=req.result
   if(!db.objectStoreNames.contains(STORE)){
    db.close();reject(Error('기존 세이브 저장 구조가 올바르지 않습니다.'));return
   }
   try{
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE)
    const keys=store.getAllKeys(),values=store.getAll()
    tx.oncomplete=()=>{
     db.close()
     if(keys.result.length!==values.result.length){
      reject(Error('저장 기록 개수가 일치하지 않습니다.'));return
     }
     resolve(keys.result.map((key,i)=>({key,value:values.result[i]})))
    }
    tx.onerror=()=>{db.close();reject(tx.error||Error('세이브 읽기 실패'))}
    tx.onabort=()=>{db.close();reject(tx.error||Error('세이브 읽기 중단'))}
   }catch(error){db.close();reject(error)}
  }
 })
}
// Keep original IndexedDB records; separately capture new LIVE/TEST mission saves.
export function readMissionRecords(storage,server){
 const key=MISSION_SAVE_KEYS[server]
 if(!key||!storage?.getItem)return []
 const raw=storage.getItem(key)
 if(raw===null||raw===undefined)return []
 let value
 try{value=JSON.parse(raw)}catch{throw Error('새 게임의 '+server+' 세이브를 읽지 못했습니다.')}
 if(!value||value.schema!==1||!Array.isArray(value.active)||!Array.isArray(value.offers)||!Number.isSafeInteger(value.cash))
  throw Error('새 게임의 '+server+' 세이브 형식이 올바르지 않습니다.')
 return [{key,format:'localStorage',value}]
}
function openBackupStore(idb){
 return new Promise((resolve,reject)=>{
  if(!idb?.open){reject(Error('백업 저장소를 사용할 수 없습니다.'));return}
  let req
  try{req=idb.open(BACKUP_DB,1)}catch(error){reject(error);return}
  req.onupgradeneeded=()=>{
   if(!req.result.objectStoreNames.contains(BACKUP_STORE))
    req.result.createObjectStore(BACKUP_STORE)
  }
  req.onerror=()=>reject(req.error||Error('백업 저장소 열기 실패'))
  req.onblocked=()=>reject(Error('다른 탭에서 백업 저장소를 사용하고 있습니다.'))
  req.onsuccess=()=>resolve(req.result)
 })
}
async function writeBackup(idb,payload){
 const db=await openBackupStore(idb)
 try{
  return await new Promise((resolve,reject)=>{
   const key=payload.server+':'+payload.at+':'+Math.random().toString(36).slice(2,12)
   const tx=db.transaction(BACKUP_STORE,'readwrite')
   tx.objectStore(BACKUP_STORE).add(payload,key)
   tx.oncomplete=()=>resolve(key)
   tx.onerror=()=>reject(tx.error||Error('백업 저장 실패'))
   tx.onabort=()=>reject(tx.error||Error('백업 저장 중단'))
  })
 }finally{db.close()}
}
async function verifyBackup(idb,key,payload){
 const db=await openBackupStore(idb)
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction(BACKUP_STORE,'readonly')
   const req=tx.objectStore(BACKUP_STORE).get(key)
   tx.oncomplete=()=>{
    try{
     // Full round-trip check, not merely successful write completion.
     if(JSON.stringify(req.result)!==JSON.stringify(payload))
      reject(Error('백업 재검증에 실패했습니다. 게임 입장을 중단합니다.'))
     else resolve(true)
    }catch(error){reject(error)}
   }
   tx.onerror=()=>reject(tx.error||Error('백업 검증 실패'))
   tx.onabort=()=>reject(tx.error||Error('백업 검증 중단'))
  })
 }finally{db.close()}
}
export async function createEntryCheckpoint({
 idb=globalThis.indexedDB,storage=globalThis.localStorage,server,revision,now=()=>Date.now(),
 read=readGameRecords,write=writeBackup,verify=verifyBackup
}={}){
 dbForServer(server)
 if(!validRevision(revision))throw Error('대상 버전을 검증할 수 없습니다.')
 const oldRecords=await read(idb,server)
 if(!Array.isArray(oldRecords))throw Error('세이브 목록을 읽지 못했습니다.')
 const records=[...oldRecords,...readMissionRecords(storage,server)]
 // A new server begins empty; a stale LIVE save is never copied into DEV/TEST.
 if(!records.length)return {records:0,backup:false}
 const payload={schema:1,server,revision,at:now(),count:records.length,records}
 const key=await write(idb,payload)
 if(!key)throw Error('백업 저장을 확인하지 못했습니다.')
 const good=await verify(idb,key,payload)
 if(good!==true)throw Error('백업 검증에 실패했습니다.')
 return {records:records.length,backup:true,key}
}
