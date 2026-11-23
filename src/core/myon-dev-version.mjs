// DEV-only save epoch. A new semantic DEV version begins with a blank test world.
// Never delete LIVE/TEST databases or backups.
import {GAME_DB,BACKUP_DB} from './myon-server-entry.mjs'

export const DEV_ACTIVE_VERSION_KEY='MYON_DEV_ACTIVE_VERSION_V1'
export const DEV_RION_CONTINUITY_KEY='MYON_RION_DISCOVERY_DEV_V1'
export const DEV_STORAGE_PREFIX='MYON_DEV_'
const DEV_BACKUP_STORE='snapshots'
const VALID_VERSION=/^\d+\.\d+\.\d+(?:\.\d+)?$/

export function purgeDevLocalKeys(storage){
 const keys=[]
 for(let i=0;i<storage.length;i++){
  const key=storage.key(i)
  if(typeof key==='string'&&((key.startsWith(DEV_STORAGE_PREFIX)&&key!==DEV_ACTIVE_VERSION_KEY)||key===DEV_RION_CONTINUITY_KEY))
   keys.push(key)
 }
 for(const key of keys)storage.removeItem(key)
 return keys.length
}

export function deleteDevGameDatabase(idb){
 if(!idb||typeof idb.deleteDatabase!=='function')return Promise.reject(Error('DEV 저장소를 초기화할 수 없습니다.'))
 return new Promise((resolve,reject)=>{
  let req
  try{req=idb.deleteDatabase(GAME_DB.dev)}catch(error){reject(error);return}
  req.onerror=()=>reject(req.error||Error('DEV 게임 저장소 초기화 실패'))
  req.onblocked=()=>reject(Error('다른 탭에서 DEV 저장소를 사용 중입니다. 다른 탭을 닫고 다시 시도하세요.'))
  req.onsuccess=()=>resolve()
 })
}

export function purgeDevBackupRecords(idb){
 if(!idb||typeof idb.open!=='function')return Promise.reject(Error('DEV 백업 저장소를 확인할 수 없습니다.'))
 return new Promise((resolve,reject)=>{
  let req
  try{req=idb.open(BACKUP_DB,1)}catch(error){reject(error);return}
  req.onupgradeneeded=()=>{
   if(!req.result.objectStoreNames.contains(DEV_BACKUP_STORE))
    req.result.createObjectStore(DEV_BACKUP_STORE)
  }
  req.onerror=()=>reject(req.error||Error('기존 백업 저장소 확인 실패'))
  req.onblocked=()=>reject(Error('다른 탭에서 백업 저장소를 사용 중입니다.'))
  req.onsuccess=()=>{
   const db=req.result
   if(!db.objectStoreNames.contains(DEV_BACKUP_STORE)){db.close();reject(Error('백업 저장 구조를 확인할 수 없습니다.'));return}
   let tx
   try{tx=db.transaction(DEV_BACKUP_STORE,'readwrite')}catch(error){db.close();reject(error);return}
   const reqCursor=tx.objectStore(DEV_BACKUP_STORE).openCursor()
   reqCursor.onsuccess=()=>{
    const cursor=reqCursor.result
    if(!cursor)return
    // Snapshot keys have the form "dev:timestamp:nonce".
    // Also check the payload to catch older DEV-only backup formats.
    if((typeof cursor.key==='string'&&cursor.key.startsWith('dev:'))||cursor.value?.server==='dev')
     cursor.delete()
    cursor.continue()
   }
   tx.oncomplete=()=>{db.close();resolve()}
   tx.onerror=()=>{db.close();reject(tx.error||Error('DEV 이전 백업 정리 실패'))}
   tx.onabort=()=>{db.close();reject(tx.error||Error('DEV 백업 정리 중단'))}
  }
 })
}

// DEV is temporary: re-entry under the same version resumes its test session.
// Every new DEV version resets only DEV storage. LIVE and TEST remain untouched.
export async function prepareDevVersion({version,storage=globalThis.localStorage,idb=globalThis.indexedDB,
 deleteDatabase=deleteDevGameDatabase,purgeBackups=purgeDevBackupRecords}={}){
 if(!VALID_VERSION.test(version||''))throw Error('DEV 버전 번호를 확인할 수 없습니다.')
 if(!storage||typeof storage.getItem!=='function')throw Error('DEV 저장 확인을 할 수 없습니다.')
 const previous=storage.getItem(DEV_ACTIVE_VERSION_KEY)
 if(previous===version)return {reset:false,version}
 await deleteDatabase(idb)
 await purgeBackups(idb)
 const removed=purgeDevLocalKeys(storage)
 storage.setItem(DEV_ACTIVE_VERSION_KEY,version)
 return {reset:true,previous,version,removed}
}
