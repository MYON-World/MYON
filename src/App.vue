<script setup>
import {onMounted,ref} from 'vue'
import {ROLLOUT_KEY,LEGACY_ROLLOUT_KEY,validRevision,validReleases,
  validStoredState,reconcileState,migrateLegacy,initialState} from './core/myon-release-state.mjs'

const BASE=String(import.meta.env.BASE_URL)
const FIRST_KNOWN='5fa8f6e36f4b1da0d66f933508d88b477193f5d5'
const frameUrl=ref('')
const loadingError=ref('')

function fromStorage(key){
 try{return JSON.parse(localStorage.getItem(key)||'null')}
 catch(error){console.warn('MYON release storage:',error);return null}
}
function existingGameMarkers(){
 // Unknown browser support means "possibly returning": never default to HEAD.
 const unknown={existing:true,bus:false,passes:false}
 if(!window.indexedDB||typeof indexedDB.databases!=='function')return Promise.resolve(unknown)
 return indexedDB.databases().then(names=>{
  if(!Array.isArray(names))return unknown
  if(!names.some(d=>d.name==='myon-v00804-progress'))
   return {existing:false,bus:false,passes:false}
  return new Promise(resolve=>{
   let finished=false
   const done=data=>{if(finished)return;finished=true;resolve(data)}
   let request
   try{request=indexedDB.open('myon-v00804-progress')}
   catch(error){done(unknown);return}
   request.onerror=()=>done(unknown)
   request.onupgradeneeded=()=>done(unknown)
   request.onsuccess=()=>{
    const db=request.result
    try{
     if(!db.objectStoreNames.contains('game')){db.close();done(unknown);return}
     const tx=db.transaction('game','readonly'),store=tx.objectStore('game')
     const bus=store.get('v01352-bus-world'),passes=store.get('v01354-special-passes')
     tx.oncomplete=()=>{db.close();done({existing:true,bus:!!bus.result,passes:!!passes.result})}
     tx.onerror=()=>{db.close();done(unknown)}
     tx.onabort=()=>{db.close();done(unknown)}
    }catch(error){db.close();done(unknown)}
   }
  })
 }).catch(()=>unknown)
}
function openPinned(sha,version){
 frameUrl.value=BASE+'releases/'+sha+'/myon.html?build='+encodeURIComponent(sha)
 document.title=version?'MYON v'+version:'MYON · 저장된 버전'
}
onMounted(async()=>{
 const saved=fromStorage(ROLLOUT_KEY),legacy=fromStorage(LEGACY_ROLLOUT_KEY)
 try{
  const response=await fetch(BASE+'myon-rollouts.json?load='+Date.now(),{cache:'no-store'})
  if(!response.ok)throw Error('MYON release manifest unavailable')
  const manifest=await response.json()
  const releases=manifest?.releases
  if(manifest?.schema!==1||!validReleases(releases))throw Error('Invalid release manifest')
  const now=Date.now()
  // Never silently replace a legitimate older pin with the newest commit.
  if(validStoredState(saved)&&!releases.some(v=>v.revision===saved.installed))
   throw Error('Pinned MYON release absent from published history')
  let state=reconcileState(saved,releases,now)||migrateLegacy(legacy,releases,now)
  if(!state)state=initialState(releases,await existingGameMarkers())
  localStorage.setItem(ROLLOUT_KEY,JSON.stringify(state))
  const pinned=releases.find(v=>v.revision===state.installed)
  openPinned(state.installed,pinned?.version)
 }catch(error){
  console.error('MYON pinned launch:',error)
  loadingError.value='업데이트 목록을 확인할 수 없습니다. 기존 버전을 유지합니다.'
  if(saved&&validStoredState(saved))openPinned(saved.installed)
  else if(legacy&&validRevision(legacy.from))openPinned(legacy.from)
  else openPinned(FIRST_KNOWN,'0.13.51')
 }
})
</script>

<template>
  <iframe v-if="frameUrl" class="game-frame" :src="frameUrl" title="MYON" />
  <div v-else class="loading">저장된 MYON 버전 확인 중…</div>
</template>

<style scoped>
.game-frame{display:block;width:100%;height:100vh;height:100dvh;border:0;background:#0e171b}
.loading{height:100dvh;display:grid;place-items:center;background:#0e171b;color:#b5d6cb;font-size:13px}
</style>
