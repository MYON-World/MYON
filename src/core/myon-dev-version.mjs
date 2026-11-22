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
  if(typeof key==='string'&&key.startsWith(DEV_STORAGE_PREFIX)&&key!==DEV_ACTIVE_VERSION_KEY)
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

// Archive actual discoveries outside the purged DEV prefix before a reset.
// Never grant these archived discoveries to a freshly created world.
function preserveRionDiscovery(storage,previous){
 if(!previous)return;
 const raw=storage.getItem('MYON_DEV_MISSIONS_V1_'+previous);
 if(!raw)return;
 let saved;
 try{saved=JSON.parse(raw)}catch{throw Error('이전 DEV 기록을 확인할 수 없어 리온 보존을 중단했습니다.')}
 if(!saved||saved.schema!==1||!Array.isArray(saved.offers)||!Array.isArray(saved.active))
  throw Error('이전 DEV 기록을 확인할 수 없어 리온 보존을 중단했습니다.');
 if(!saved.rions)return; // Pre-Rion versions have no discovery to preserve.
 const json=JSON.stringify(saved.rions);
 storage.setItem(DEV_RION_CONTINUITY_KEY,json);
 if(storage.getItem(DEV_RION_CONTINUITY_KEY)!==json)
  throw Error('리온 발견 기록 영구 저장을 확인하지 못했습니다.');
}

// "Version" is the release number, not the commit SHA. A test-only commit
// under the same version must not erase a player who is still testing it.
export async function prepareDevVersion({version,storage=globalThis.localStorage,idb=globalThis.indexedDB,
 deleteDatabase=deleteDevGameDatabase,purgeBackups=purgeDevBackupRecords}={}){
 if(!VALID_VERSION.test(version||''))throw Error('DEV 버전 번호를 확인할 수 없습니다.')
 if(!storage||typeof storage.getItem!=='function')throw Error('DEV 저장 확인을 할 수 없습니다.')
 const previous=storage.getItem(DEV_ACTIVE_VERSION_KEY)
 if(previous===version)return {reset:false,version}
 // One-time simplification: carry forward only mission progress in the next DEV
 // runtime. Never overwrite prior keys or purge the player's historical saves.
 if(version==='0.14.9'&&['0.14.8','0.14.7.1'].includes(previous)){
  const old=storage.getItem('MYON_DEV_MISSIONS_V1_'+previous);
  if(old){
   let snapshot;
   try{snapshot=JSON.parse(old)}catch{throw Error('기존 DEV 임무 기록이 손상되어 전환을 중단했습니다.')}
   if(snapshot?.schema!==1||!Array.isArray(snapshot.stats)||snapshot.stats.length!==150
      ||!Array.isArray(snapshot.offers)||!Array.isArray(snapshot.active)
      ||!Array.isArray(snapshot.history)||!Number.isSafeInteger(snapshot.cash))
    throw Error('기존 DEV 임무 데이터를 확인할 수 없어 전환을 중단했습니다.');
  }
  storage.setItem(DEV_ACTIVE_VERSION_KEY,version);
  return {reset:false,migrated:true,previous,version,removed:0};
 }
 preserveRionDiscovery(storage,previous);
 // One-time v0.13.95 -> v0.13.96 migration retains existing mission progress.
 // Older keys remain untouched; the new game copies and validates the previous save.
 if(previous==='0.14.7.1'&&version==='0.14.8'){
  // Do not wipe cash, missions, mining or Rion discovery. The runtime resets
  // only worldR0 sites and rewrites a validated schema-3 snapshot to the new key.
  const raw=storage.getItem('MYON_DEV_MISSIONS_V1_0.14.7.1');
  if(raw){
   let old;
   try{old=JSON.parse(raw)}catch{throw Error('이전 DEV 저장이 손상되어 단지 초기화를 중단합니다.')}
   if(old?.schema!==1||!Array.isArray(old.offers)||!Array.isArray(old.active)
      ||!Number.isSafeInteger(old.cash)||!old.rions)
    throw Error('기존 DEV 세이브를 확인할 수 없어 단지 초기화를 중단합니다.');
  }
  storage.setItem(DEV_ACTIVE_VERSION_KEY,version);
  return {reset:false,migrated:true,previous,version,removed:0};
 }
 if(previous==='0.14.6.1'&&version==='0.14.7.1'){
  // Keep the complete previous DEV mission save, including discovered sites.
  // The new runtime validates and copies that record to its new versioned key.
  const oldKey='MYON_DEV_MISSIONS_V1_0.14.6.1';
  const oldRaw=storage.getItem(oldKey);
  if(oldRaw){
   let old;
   try{old=JSON.parse(oldRaw)}catch{throw Error('이전 DEV 기록이 손상되어 업데이트를 중단합니다.')}
   if(old?.schema!==1||!Array.isArray(old.offers)||!Array.isArray(old.active)
      ||!Number.isSafeInteger(old.cash)||!old.rions)
    throw Error('이전 DEV 기록을 검증할 수 없어 업데이트를 중단합니다.');
  }
  storage.setItem(DEV_ACTIVE_VERSION_KEY,version);
  return {reset:false,migrated:true,previous,version,removed:0};
 }
 if(previous==='0.14.5.3'&&version==='0.14.6.1'){
  // Preserve this DEV world's mission, mining, cash and Rion state for World R0.
  // The new runtime loads the previous versioned mission key without deleting it.
  const oldKey='MYON_DEV_MISSIONS_V1_0.14.5.3';
  const oldRaw=storage.getItem(oldKey);
  if(oldRaw){
   let old;
   try{old=JSON.parse(oldRaw)}catch{throw Error('이전 DEV 기록이 손상되어 업데이트를 중단합니다.')}
   if(old?.schema!==1||!Array.isArray(old.offers)||!Array.isArray(old.active)||!Number.isSafeInteger(old.cash))
    throw Error('이전 DEV 저장 구조를 검증할 수 없어 업데이트를 중단합니다.');
  }
  storage.setItem(DEV_ACTIVE_VERSION_KEY,version);
  return {reset:false,migrated:true,previous,version,removed:0};
 }
 if(previous==='0.13.95'&&version==='0.13.96'){
  storage.setItem(DEV_ACTIVE_VERSION_KEY,version);
  return {reset:false,migrated:true,previous,version,removed:0};
 }
 // Do not mark an epoch complete until all DEV-only cleanup has succeeded.
 await deleteDatabase(idb)
 await purgeBackups(idb)
 const removed=purgeDevLocalKeys(storage)
 storage.setItem(DEV_ACTIVE_VERSION_KEY,version)
 return {reset:true,previous,version,removed}
}
