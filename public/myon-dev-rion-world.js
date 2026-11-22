/* MYON DEV World Rion R0 — empty-first-world and targeted random discovery.
   DEV schema 3 clears all legacy sites once; other game progress remains unchanged. */
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
 const seed=Math.floor(Math.max(0,Math.min(.9999999999,random()))*4294967296)>>>0;
 return {schema:3,generator:GENERATOR,seed,createdAt:now,baseCount:0,discoveredCount:0,batches:[]};
}
function valid(state){
 if(!state||![1,2,3].includes(state.schema)||state.generator!==GENERATOR
  ||!Number.isSafeInteger(state.seed)||state.seed<0||state.seed>0xffffffff
  ||!Number.isSafeInteger(state.createdAt)||state.createdAt<=0
  ||!Number.isSafeInteger(state.discoveredCount)||state.discoveredCount<(state.schema===3?0:3)
  ||state.discoveredCount>MAX_SITES)return false;
 if(state.schema===1)return true;
 if(!Number.isSafeInteger(state.baseCount)||state.baseCount<(state.schema===3?0:3)
  ||(state.schema===3&&state.baseCount!==0)||state.baseCount>state.discoveredCount
  ||!Array.isArray(state.batches)||state.batches.length>state.discoveredCount-state.baseCount)return false;
 let start=state.baseCount;
 for(const batch of state.batches){
  if(!batch||batch.from!==start||!Number.isSafeInteger(batch.count)||batch.count<1
   ||!TYPES.includes(batch.type)||batch.count>MAX_SITES-start)return false;
  start+=batch.count;
 }
 return start===state.discoveredCount;
}
function migrate(input){
 if(!valid(input))return null;
 if(input.schema===3)return input;
 // One-time site reset: no previously generated/discovered sites survive.
 // Seed and world discovery time stay stable; only the site's count/records reset.
 return {schema:3,generator:input.generator,seed:input.seed,createdAt:input.createdAt,
  baseCount:0,discoveredCount:0,batches:[]};
}
function checkIndex(state,index){
 if(!valid(state)||!Number.isSafeInteger(index)||index<0||index>=state.discoveredCount)
  throw Error('발견되지 않은 단지입니다.');
}
function siteType(state,index){
 if(state.schema>=2&&index>=state.baseCount){
  // In schema 3, every site comes from a chosen-type exploration batch.
  let lo=0,hi=state.batches.length-1;
  while(lo<=hi){
   const mid=Math.floor((lo+hi)/2),batch=state.batches[mid];
   if(index<batch.from)hi=mid-1;
   else if(index>=batch.from+batch.count)lo=mid+1;
   else return batch.type;
  }
  throw Error('단지 유형 데이터가 손상되었습니다.');
 }
 return TYPES[hash(state.seed,index,29)%TYPES.length];
}
function district(state,index){
 checkIndex(state,index);
 const kind=siteType(state,index);
 const number=String(index+1).padStart(3,'0');
 return {id:'SITE-'+String(index+1).padStart(6,'0'),index,name:kind+' '+number,type:kind};
}
// Positions stay private; only the calculated site-to-site distance is displayed.
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
 if(!valid(state)||!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(limit)
  ||limit<1||limit>100)throw Error('단지 목록 범위가 올바르지 않습니다.');
 const entries=[];
 for(let i=start;i<Math.min(state.discoveredCount,start+limit);i++)entries.push(district(state,i));
 return entries;
}
// Targeted exploration may find none, one, or multiple already-existing sites.
// No action constructs facilities, and a failed search must not alter the save.
function explore(input,type,random=Math.random){
 const state=migrate(input);
 if(!state||!TYPES.includes(type)||state.discoveredCount>=MAX_SITES)return null;
 const roll=random();
 if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('탐색 무작위 값이 올바르지 않습니다.');
 let foundCount=roll<.20?0:roll<.70?1:roll<.93?2:3;
 foundCount=Math.min(foundCount,MAX_SITES-state.discoveredCount);
 if(foundCount===0)return {state,foundCount:0,from:state.discoveredCount,type};
 const from=state.discoveredCount;
 const batch={from,count:foundCount,type};
 return {state:{...state,discoveredCount:from+foundCount,
  batches:[...state.batches,batch]},foundCount,from,type};
}
root.MYON_DEV_RION_WORLD=Object.freeze({
 ID,TYPES,GENERATOR,MAX_SITES,found,initialState,valid,migrate,district,distance,list,explore
});
})(typeof window!=='undefined'?window:globalThis);
