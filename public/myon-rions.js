/* MYON Rion stage-0 identity/discovery engine. No economy mutations. */
(function(root){
'use strict';
const DAY=86400000,HOUR=3600000;
const ALIASES=Object.freeze({'rion.role.user':'rion.role.ui','rion.role.encyclopedia':'rion.role.wiki'});
const idOf=id=>ALIASES[id]||id;
const randomIndex=(length,random)=>Math.min(length-1,Math.floor(Math.max(0,Math.min(.999999999,random()))*length));
const nextAt=(now,random)=>now+1+Math.floor(Math.max(0,Math.min(.999999999,random()))*DAY);
const known=(definitions,id)=>definitions.some(r=>r.id===id);
function fresh(now,random=Math.random){return {schema:1,discovered:[],pending:null,nextAt:nextAt(now,random),latest:null}}
function valid(state,definitions){
 if(!state||state.schema!==1||!Array.isArray(state.discovered)||state.discovered.length>definitions.length
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
    ||p.createdAt<=0||p.expiresAt!==p.createdAt+HOUR)return false;
 }
 if(state.latest!==null){
  const d=state.latest;
  if(!d||!seen.has(d.id)||!Number.isSafeInteger(d.at)||d.at<=0)return false;
 }
 return true;
}
function initialize(input,definitions,now=Date.now(),random=Math.random){
 if(!input)return fresh(now,random);
 const state=JSON.parse(JSON.stringify(input));
 if(Array.isArray(state.discovered))for(const d of state.discovered)d.id=idOf(d.id);
 if(state.pending)state.pending.id=idOf(state.pending.id);
 if(state.latest)state.latest.id=idOf(state.latest.id);
 return valid(state,definitions)?state:null;
}
function discovered(state,id){return !!state?.discovered?.some(d=>d.id===idOf(id))}
function advance(input,definitions,now=Date.now(),random=Math.random){
 const state=JSON.parse(JSON.stringify(input));
 if(!valid(state,definitions))throw Error('리온 발견 기록이 손상되었습니다.');
 let changed=false;
 if(state.pending&&state.pending.expiresAt<=now){
  state.pending=null;state.nextAt=nextAt(now,random);changed=true;
 }
 const remaining=definitions.filter(r=>!discovered(state,r.id));
 if(!remaining.length){
  if(state.pending||state.nextAt!==null){state.pending=null;state.nextAt=null;changed=true}
 }else if(!state.pending&&state.nextAt!==null&&state.nextAt<=now){
  if(now>=state.nextAt+HOUR){
   state.nextAt=nextAt(now,random);changed=true; // An offline encounter already expired.
  }else{
   const target=remaining[randomIndex(remaining.length,random)];
   state.pending={id:target.id,createdAt:state.nextAt,expiresAt:state.nextAt+HOUR};
   state.nextAt=null;changed=true;
  }
 }
 return {state,changed};
}
function accept(input,definitions,now=Date.now(),random=Math.random){
 if(!valid(input,definitions)||!input.pending||input.pending.expiresAt<=now)return null;
 const state=JSON.parse(JSON.stringify(input)),id=state.pending.id;
 state.discovered.push({id,stage:0,discoveredAt:now});
 state.latest={id,at:now};
 state.pending=null;
 state.nextAt=state.discovered.length===definitions.length?null:nextAt(now,random);
 return {state,id};
}
function contributionId(state,definitions,random=Math.random){
 const pool=definitions.filter(r=>r.kind==='field'&&discovered(state,r.id));
 return pool.length?pool[randomIndex(pool.length,random)].id:null;
}
root.MYON_RIONS=Object.freeze({DAY,HOUR,ALIASES,idOf,initialize,valid,advance,accept,discovered,contributionId});
})(typeof window!=='undefined'?window:globalThis);
