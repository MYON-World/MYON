// Source-of-truth for MYON's installed commit, never a latest-version alias.
export const ROLLOUT_KEY='myon-release-state-v2';
export const LEGACY_ROLLOUT_KEY='myon-commit-rollout-v1';
const SHA=/^[a-f0-9]{40}$/i;
export function validRevision(value){return typeof value==='string'&&SHA.test(value);}
export function validReleases(releases){
 return Array.isArray(releases)&&releases.length>0&&
  releases.every(v=>v&&validRevision(v.revision)&&/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(v.version))&&
  new Set(releases.map(v=>v.revision)).size===releases.length;
}
export function following(releases,sha){
 const index=releases.findIndex(v=>v.revision===sha);
 return index<0?null:releases[index+1]||null;
}
export function validStoredState(value){
 return !!(value&&value.schema===2&&validRevision(value.installed)&&
  ['idle','rollout','cooldown'].includes(value.phase)&&
  Number.isSafeInteger(value.startedAt)&&value.startedAt>=0&&
  (value.target===''||validRevision(value.target)));
}
export function reconcileState(raw,releases,now){
 if(!validStoredState(raw)||!releases.some(v=>v.revision===raw.installed))return null;
 const state={schema:2,installed:raw.installed,phase:raw.phase,target:raw.target,startedAt:raw.startedAt};
 const next=following(releases,state.installed);
 if(state.phase==='rollout'){
  if(!next)return {schema:2,installed:state.installed,phase:'idle',target:'',startedAt:0};
  // Repair a skipped target. A newly published commit never changes a valid rollout.
  if(state.target!==next.revision)state.target=next.revision;
  if(state.startedAt<=0||state.startedAt>now+60000)state.startedAt=now;
 }else{
  state.target='';
  if(state.phase==='idle')state.startedAt=0;
  if(state.phase==='cooldown'&&(state.startedAt<=0||state.startedAt>now+60000))
   state.startedAt=now;
 }
 return state;
}
export function migrateLegacy(raw,releases,now){
 if(!raw||typeof raw.from!=='string')return null;
 let installed=raw.from;
 if(!validRevision(installed)){
  const match=/^version:(\d+\.\d+\.\d+(?:\.\d+)?)$/.exec(installed);
  installed=match?releases.find(v=>v.version===match[1])?.revision:null;
 }
 if(!installed||!releases.some(v=>v.revision===installed))return null;
 const next=following(releases,installed);
 if(!next)return {schema:2,installed,phase:'idle',target:'',startedAt:0};
 // Legacy updater could point at HEAD, skipping middle commits. The old hour
 // belongs to this one only when the old target already was exactly next.
 const sameTarget=raw.target===next.revision;
 const validStart=Number.isSafeInteger(raw.startedAt)&&raw.startedAt>0&&raw.startedAt<=now+60000;
 return {schema:2,installed,phase:'rollout',target:next.revision,
  startedAt:sameTarget&&validStart?raw.startedAt:now};
}
export function initialState(releases,{existing=false,bus=false,passes=false}={}){
 if(!validReleases(releases))throw Error('Missing valid release history');
 // Identifiable saved schema records prove some versions have been used already.
 // Never send a returning player directly to the latest deployed commit.
 const findVersion=version=>releases.find(v=>v.version===version)?.revision||releases[0].revision;
 const installed=passes?findVersion('0.13.54'):bus?findVersion('0.13.52'):
  existing?releases[0].revision:releases[releases.length-1].revision;
 return {schema:2,installed,phase:'idle',target:'',startedAt:0};
}
