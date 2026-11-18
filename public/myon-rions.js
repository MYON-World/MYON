/* MYON Rion stage-0 identity/discovery engine. No economy mutations. */
(function(root){
'use strict';
const HOUR=3600000;
const ALIASES=Object.freeze({'rion.role.user':'rion.role.ui','rion.role.encyclopedia':'rion.role.wiki'});
const idOf=id=>ALIASES[id]||id;
const randomIndex=(length,random)=>Math.min(length-1,Math.floor(Math.max(0,Math.min(.999999999,random()))*length));
const nextAt=now=>now+HOUR;
const known=(definitions,id)=>definitions.some(r=>r.id===id);
function fresh(now){return {schema:2,discovered:[],pending:null,nextAt:nextAt(now),latest:null}}
function valid(state,definitions){
 if(!state||state.schema!==2||!Array.isArray(state.discovered)||state.discovered.length>definitions.length
   ||!(state.nextAt===null||(Number.isSafeInteger(state.nextAt)&&state.nextAt>0)))return false;
 const seen=new Set();
 for(const d of state.discovered){
  if(!d||typeof d.id!=='string'||!known(definitions,d.id)||seen.has(d.id)
   ||d.stage!==0||!Number.isSafeInteger(d.discoveredAt)||d.discoveredAt<=0)return false;
  seen.add(d.id);
 }
 if(state.pending!==null){
  const p=state.pending;
  if(!p||!known(definitions,p.id)||seen.has(p.id)||!Number.isSafeInteger(p.createdAt)
    ||p.createdAt<=0||state.nextAt!==null)return false;
 }
 if(state.latest!==null){
  const d=state.latest;
  if(!d||!seen.has(d.id)||!Number.isSafeInteger(d.at)||d.at<=0)return false;
 }
 return true;
}
function initialize(input,definitions,now=Date.now()){
 if(!input)return fresh(now);
 const state=JSON.parse(JSON.stringify(input));
 if(Array.isArray(state.discovered))for(const d of state.discovered)d.id=idOf(d.id);
 if(state.pending)state.pending.id=idOf(state.pending.id);
 if(state.latest)state.latest.id=idOf(state.latest.id);
 if(state.schema===1){
  // Legacy 24h/random and 60-minute expiry saves: keep any unaccepted Rion,
  // even if its old expiry date has already passed.
  state.schema=2;
  if(state.pending){
   delete state.pending.expiresAt;
   state.nextAt=null;
  }else{
   const last=state.latest?.at||Math.max(0,...(state.discovered||[]).map(d=>d.discoveredAt||0));
   state.nextAt=(state.discovered||[]).length===definitions.length?null:nextAt(last||now);
  }
 }
 return valid(state,definitions)?state:null;
}
function discovered(state,id){return !!state?.discovered?.some(d=>d.id===idOf(id))}
function advance(input,definitions,now=Date.now(),random=Math.random){
 const state=JSON.parse(JSON.stringify(input));
 if(!valid(state,definitions))throw Error('리온 발견 기록이 손상되었습니다.');
 let changed=false;
 const remaining=definitions.filter(r=>!discovered(state,r.id));
 if(!remaining.length){
  if(state.pending||state.nextAt!==null){state.pending=null;state.nextAt=null;changed=true}
 }else if(!state.pending&&state.nextAt!==null&&state.nextAt<=now){
  const target=remaining[randomIndex(remaining.length,random)];
  // An offered discovery never expires or gets replaced until accepted.
  state.pending={id:target.id,createdAt:state.nextAt};
  state.nextAt=null;changed=true;
 }
 return {state,changed};
}
function accept(input,definitions,now=Date.now()){
 if(!valid(input,definitions)||!input.pending)return null;
 const state=JSON.parse(JSON.stringify(input)),id=state.pending.id;
 state.discovered.push({id,stage:0,discoveredAt:now});
 state.latest={id,at:now};
 state.pending=null;
 state.nextAt=state.discovered.length===definitions.length?null:nextAt(now);
 return {state,id};
}
function contributionId(state,definitions,random=Math.random){
 const pool=definitions.filter(r=>r.kind==='field'&&discovered(state,r.id));
 return pool.length?pool[randomIndex(pool.length,random)].id:null;
}
root.MYON_RIONS=Object.freeze({HOUR,ALIASES,idOf,initialize,valid,advance,accept,discovered,contributionId});
})(typeof window!=='undefined'?window:globalThis);
