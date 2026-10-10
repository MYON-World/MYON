/** Fresh save namespace. Previous browser data is neither imported nor overwritten. */
import { isValidGame, normalizeImport } from './gameEngine.js'
const DB_NAME='myon-world-custom-start-v001'
const STORE='snapshots'
const KEY='primary'
const FALLBACK_KEY='myon-world-custom-start-v001-cache'
async function openDb(){
  return await new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined') return reject(new Error('IndexedDB unavailable'))
    const r=indexedDB.open(DB_NAME,1)
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)}
    r.onsuccess=()=>resolve(r.result)
    r.onerror=()=>reject(r.error||new Error('IndexedDB open failed'))
    r.onblocked=()=>reject(new Error('IndexedDB blocked'))
  })
}
export async function loadFromIndexedDB(){
  const db=await openDb()
  try{return await new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).get(KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
  finally{db.close()}
}
export async function saveToIndexedDB(data){
  if(!isValidGame(data))throw new Error('저장 데이터 검증 실패')
  const db=await openDb()
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(data,KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transaction aborted'))})}
  finally{db.close()}
}
export const makePlainSnapshot=g=>JSON.parse(JSON.stringify(g))
export function loadFallback(){try{const x=JSON.parse(localStorage.getItem(FALLBACK_KEY)||'null');return x?normalizeImport(x):null}catch{return null}}
export function saveFallback(g){if(!isValidGame(g))throw new Error('저장 데이터 검증 실패');localStorage.setItem(FALLBACK_KEY,JSON.stringify(g))}
export function downloadSaveJson(g){
  if(!isValidGame(g))throw new Error('저장 데이터 검증 실패')
  const blob=new Blob([JSON.stringify({...makePlainSnapshot(g),exportedAt:new Date().toISOString()},null,2)],{type:'application/json;charset=utf-8'})
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='save.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)
}
export function parseSaveJson(text,now=Date.now()){
  let obj;try{obj=JSON.parse(text)}catch{throw new Error('JSON 형식이 올바르지 않습니다.')}
  return normalizeImport(obj,now)
}
