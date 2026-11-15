<script setup>
import {onMounted,ref} from 'vue'

const BASE=String(import.meta.env.BASE_URL)
const STATE_KEY='myon-release-state-v2'
const OLD_KEY='myon-commit-rollout-v1'
const BASELINE='138af3bb1d83935e5f107fc937de206f895617c0'
const frameUrl=ref('')
const loadingError=ref('')

function validRevision(value){return typeof value==='string'&&/^[a-f0-9]{40}$/i.test(value)}
function savedState(){
 try{
  const item=JSON.parse(localStorage.getItem(STATE_KEY)||'null')
  if(item&&item.schema===2&&validRevision(item.installed)&&
    ['idle','rollout','cooldown'].includes(item.phase)&&
    Number.isSafeInteger(item.startedAt)&&item.startedAt>=0&&
    (item.target===''||validRevision(item.target)))return item
 }catch(error){console.warn('MYON saved release state:',error)}
 return null
}
async function newState(versions){
 const available=new Set(versions.map(v=>v.revision))
 try{
  const old=JSON.parse(localStorage.getItem(OLD_KEY)||'null')
  if(old&&typeof old.from==='string'&&available.has(old.from)){
   const start=Number.isSafeInteger(old.startedAt)&&old.startedAt>0?old.startedAt:Date.now()
   const idx=versions.findIndex(v=>v.revision===old.from)
   const next=versions[idx+1]
   return {schema:2,installed:old.from,phase:next?'rollout':'idle',target:next?.revision||'',startedAt:next?start:0}
  }
 }catch(error){console.warn('MYON legacy release read:',error)}
 // Returning players must not silently jump from the previous build to HEAD.
 let existingPlayer=false
 try{
  const dbs=typeof indexedDB.databases==='function'?await indexedDB.databases():null
  existingPlayer=dbs===null||dbs.some(v=>v.name==='myon-v00804-progress')
 }catch(error){existingPlayer=true}
 const installed=existingPlayer&&available.has(BASELINE)?BASELINE:versions[versions.length-1].revision
 return {schema:2,installed,phase:'idle',target:'',startedAt:0}
}
onMounted(async()=>{
 const stored=savedState()
 try{
  const response=await fetch(BASE+'myon-rollouts.json?load='+Date.now(),{cache:'no-store'})
  if(!response.ok)throw Error('MYON rollout manifest unavailable')
  const manifest=await response.json()
  if(manifest.schema!==1||!Array.isArray(manifest.releases)||!manifest.releases.length)throw Error('Invalid release manifest')
  const versions=manifest.releases
  if(!versions.every(v=>validRevision(v.revision)))throw Error('Invalid release revision')
  const available=new Set(versions.map(v=>v.revision))
  const state=stored&&available.has(stored.installed)?stored:await newState(versions)
  localStorage.setItem(STATE_KEY,JSON.stringify(state))
  frameUrl.value=BASE+'releases/'+state.installed+'/myon.html?build='+encodeURIComponent(state.installed)
 }catch(error){
  console.warn('MYON release bootstrap:',error)
  if(stored){
   frameUrl.value=BASE+'releases/'+stored.installed+'/myon.html?build='+encodeURIComponent(stored.installed)
  }else{
   // Safe first-load fallback: do not pick a possibly newer game without a manifest.
   frameUrl.value=BASE+'releases/'+BASELINE+'/myon.html?build='+BASELINE
  }
  loadingError.value='업데이트 목록 확인 불가 · 저장된 버전으로 실행'
 }
})
</script>

<template>
  <iframe v-if="frameUrl" class="game-frame" :src="frameUrl" title="MYON" />
  <div v-else class="loading">MYON 버전 확인 중…</div>
</template>

<style scoped>
.game-frame{display:block;width:100%;height:100vh;height:100dvh;border:0;background:#0e171b}
.loading{height:100dvh;display:grid;place-items:center;background:#0e171b;color:#b5d6cb;font-size:13px}
</style>
