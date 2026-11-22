/* MYON DEV World Rion R0 — stable invisible sites and on-demand distances.
   No map, construction, ore mutation, LIVE/TEST save access, or per-pair distance storage. */
(function(root){
'use strict';
const ID='rion.role.world';
const TYPES=Object.freeze(['채광단지','정제단지','산업단지','물류단지','주거단지','상업단지']);
const GENERATOR=1;
const MAX_SITES=4294967295;
function hash(seed,index,salt){
 let x=(seed^Math.imul((index+1)>>>0,0x9e3779b9)^Math.imul(salt+1,0x85ebca6b))>>>0;
 x=Math.imul(x^(x>>>16),0x7feb352d);
 x=Math.imul(x^(x>>>15),0x846ca68b);
 return (x^(x>>>16))>>>0;
}
function found(rions){return !!rions?.discovered?.some(r=>r.id===ID)}
function initialState(now=Date.now(),random=Math.random){
 const seed=Math.floor(Math.max(0,Math.min(0.9999999999,random()))*4294967296)>>>0;
 return {schema:1,generator:GENERATOR,seed,createdAt:now,discoveredCount:3+hash(seed,0,17)%6};
}
function valid(state){
 return !!(state&&state.schema===1&&state.generator===GENERATOR
  &&Number.isSafeInteger(state.seed)&&state.seed>=0&&state.seed<=0xffffffff
  &&Number.isSafeInteger(state.createdAt)&&state.createdAt>0
  &&Number.isSafeInteger(state.discoveredCount)&&state.discoveredCount>=3
  &&state.discoveredCount<=MAX_SITES);
}
function checkIndex(state,index){
 if(!valid(state)||!Number.isSafeInteger(index)||index<0||index>=state.discoveredCount)
  throw Error('발견되지 않은 단지입니다.');
}
function district(state,index){
 checkIndex(state,index);
 const kind=TYPES[hash(state.seed,index,29)%TYPES.length];
 const number=String(index+1).padStart(3,'0');
 return {id:'SITE-'+String(index+1).padStart(6,'0'),index,name:kind+' '+number,type:kind};
}
// Private, versioned metric only: coordinates are neither shown nor persisted.
// The same seed and index always produce the same site location.
function position(state,index){
 const angle=index*2.399963229728653+(state.seed/4294967296)*Math.PI*2;
 const radius=Math.sqrt(index+1)*(12+hash(state.seed,index,13)%32);
 return {x:Math.cos(angle)*radius,y:Math.sin(angle)*radius};
}
function distance(state,sourceIndex,targetIndex){
 checkIndex(state,sourceIndex);checkIndex(state,targetIndex);
 if(sourceIndex===targetIndex)return 0;
 const a=position(state,sourceIndex),b=position(state,targetIndex);
 return Math.max(1,Math.round(Math.hypot(a.x-b.x,a.y-b.y)));
}
function list(state,start=0,limit=30){
 if(!valid(state)||!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
  throw Error('단지 목록 범위가 올바르지 않습니다.');
 const entries=[];
 for(let i=start;i<Math.min(state.discoveredCount,start+limit);i++)entries.push(district(state,i));
 return entries;
}
function discoverMore(input){
 if(!valid(input))return null;
 if(input.discoveredCount>=MAX_SITES)return null;
 const count=Math.min(MAX_SITES,input.discoveredCount+1+hash(input.seed,input.discoveredCount,41)%4);
 return {...input,discoveredCount:count};
}
root.MYON_DEV_RION_WORLD=Object.freeze({
 ID,TYPES,GENERATOR,MAX_SITES,found,initialState,valid,district,distance,list,discoverMore
});
})(typeof window!=='undefined'?window:globalThis);
