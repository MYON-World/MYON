/* MYON DEV v0.14.5: sequential Rion discovery and stage-zero Myonite mining.
   This module has no side effects and does not change LIVE or TEST gameplay. */
(function(root){
'use strict';
const ORDER=Object.freeze(['rion.role.mission','rion.material.myonite','rion.role.mining']);
const WORLD_ORDER=Object.freeze([...ORDER,'rion.role.world']);
const CONFIG=Object.freeze({
 mission:Object.freeze({temporaryStorageTons:10}),
 myonite:Object.freeze({tonsPerMine:1,pricePerTonM:100}),
 mining:Object.freeze({durationMs:60000,efficiencyBonusPercent:0})
});
const copy=x=>JSON.parse(JSON.stringify(x));
const found=(rions,id)=>!!rions?.discovered?.some(x=>x.id===id);
const canMine=rions=>ORDER.every(id=>found(rions,id));
function prepareDiscovery(input,now=Date.now(),includeWorld=false){
 const state=copy(input);
 const next=(includeWorld?WORLD_ORDER:ORDER).find(id=>!found(state,id));
 const isSame=next?state.pending?.id===next&&state.nextAt===null:state.pending===null&&state.nextAt===null;
 if(isSame)return {state,changed:false};
 state.pending=next?{id:next,createdAt:now}:null;
 state.nextAt=null;
 return {state,changed:true};
}
const initialState=()=>({schema:1,storedTons:0,active:null,awaitingChoiceTons:0});
function valid(x){
 return !!(x&&x.schema===1&&Number.isSafeInteger(x.storedTons)
  &&x.storedTons>=0&&x.storedTons<=CONFIG.mission.temporaryStorageTons
  &&Number.isSafeInteger(x.awaitingChoiceTons)
  &&x.awaitingChoiceTons>=0&&x.awaitingChoiceTons<=CONFIG.myonite.tonsPerMine
  &&(x.active===null||(x.active&&Number.isSafeInteger(x.active.startedAt)&&x.active.startedAt>0
   &&Number.isSafeInteger(x.active.endsAt)
   &&x.active.endsAt===x.active.startedAt+CONFIG.mining.durationMs))
  &&!(x.active&&x.awaitingChoiceTons));
}
function start(input,rions,now=Date.now()){
 if(!valid(input)||!canMine(rions)||input.active||input.awaitingChoiceTons)return null;
 const state=copy(input);
 state.active={startedAt:now,endsAt:now+CONFIG.mining.durationMs};
 return state;
}
function finish(input,now=Date.now()){
 if(!valid(input)||!input.active||input.active.endsAt>now)return null;
 const state=copy(input);
 state.active=null;state.awaitingChoiceTons=CONFIG.myonite.tonsPerMine;
 return state;
}
function sellNew(input){
 if(!valid(input)||!input.awaitingChoiceTons)return null;
 const state=copy(input),earnedM=state.awaitingChoiceTons*CONFIG.myonite.pricePerTonM;
 state.awaitingChoiceTons=0;
 return {state,earnedM};
}
function storeNew(input){
 if(!valid(input)||!input.awaitingChoiceTons||
   input.storedTons+input.awaitingChoiceTons>CONFIG.mission.temporaryStorageTons)return null;
 const state=copy(input);
 state.storedTons+=state.awaitingChoiceTons;
 state.awaitingChoiceTons=0;
 return state;
}
function sellStored(input,tons=1){
 if(!valid(input)||!Number.isSafeInteger(tons)||tons<=0||input.storedTons<tons)return null;
 const state=copy(input);
 state.storedTons-=tons;
 return {state,earnedM:tons*CONFIG.myonite.pricePerTonM};
}
root.MYON_DEV_RION_MINING=Object.freeze({
 ORDER,WORLD_ORDER,CONFIG,found,canMine,prepareDiscovery,initialState,valid,start,finish,sellNew,storeNew,sellStored
});
})(typeof window!=='undefined'?window:globalThis);
