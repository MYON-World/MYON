// MYON v0.13.52 — shared stop-by-stop passenger / depot settlement engine.
// LV.1 Ddok bus is the first client. Rail and later buses can reuse these rules.
(function(root){
'use strict';
const DAY=86400,HOUR=3600,KST=9*HOUR;
const CAPACITY=15,FARE=1650,PRICE=60000000,TARGET=1000,MAX_VEHICLES=100;
const REVENUE_UNLOCK_PRICE=100000; // 10만원 per +1 percentage point; adjustable game balance.
function random(vehicle,min,max){
 let n=(vehicle.seed+0x6d2b79f5)>>>0;
 vehicle.seed=n;
 n=Math.imul(n^(n>>>15),n|1);
 n^=n+Math.imul(n^(n>>>7),n|61);
 const v=((n^(n>>>14))>>>0);
 return min+(v%(max-min+1));
}
function vehicle(id,origin,now){
 return {id,origin,enabled:true,createdAt:now,seed:((Math.random()*4294967296)>>>0)||id,
  phase:'idle',nextAt:0,shiftEnd:0,shiftLabel:'',onboard:0,waiting:0,
  gross:0,boarded:0,alighted:0,lastBoarded:0,lastAlighted:0,
  lastSettlement:0,lastSettlementAt:0,finishedShifts:0};
}
function initial(now){
 return {schema:1,level:1,completed:0,upgrades:{revenue:0},nextId:2,
  vehicles:[vehicle(1,'city',now)],lastAt:now};
}
function valid(s){
 if(!s||s.schema!==1||s.level!==1||!Number.isSafeInteger(s.completed)||s.completed<0||
  !s.upgrades||!Number.isSafeInteger(s.upgrades.revenue)||s.upgrades.revenue<0||s.upgrades.revenue>60||
  !Number.isSafeInteger(s.lastAt)||s.lastAt<=0||!Number.isSafeInteger(s.nextId)||s.nextId<2||
  !Array.isArray(s.vehicles)||s.vehicles.length<1||s.vehicles.length>MAX_VEHICLES)return false;
 const ids=new Set();
 return s.vehicles.every(v=>{
  if(!v||!Number.isSafeInteger(v.id)||v.id<1||v.id>=s.nextId||ids.has(v.id)||
   !['city','new'].includes(v.origin)||typeof v.enabled!=='boolean'||
   !['idle','running','returning'].includes(v.phase)||!Number.isSafeInteger(v.seed)||
   !Number.isSafeInteger(v.createdAt)||v.createdAt<=0||!Number.isSafeInteger(v.nextAt)||v.nextAt<0||
   !Number.isSafeInteger(v.shiftEnd)||v.shiftEnd<0||typeof v.shiftLabel!=='string'||
   !Number.isSafeInteger(v.onboard)||v.onboard<0||v.onboard>CAPACITY||
   !Number.isSafeInteger(v.waiting)||v.waiting<0||
   !Number.isSafeInteger(v.gross)||v.gross<0||
   !Number.isSafeInteger(v.boarded)||v.boarded<0||
   !Number.isSafeInteger(v.alighted)||v.alighted<0||
   !Number.isSafeInteger(v.lastBoarded)||v.lastBoarded<0||
   !Number.isSafeInteger(v.lastAlighted)||v.lastAlighted<0||
   !Number.isSafeInteger(v.lastSettlement)||v.lastSettlement<0||
   !Number.isSafeInteger(v.lastSettlementAt)||v.lastSettlementAt<0||
   !Number.isSafeInteger(v.finishedShifts)||v.finishedShifts<0)return false;
  ids.add(v.id);return true;
 });
}
function rate(s){return Math.min(100,40+s.upgrades.revenue);}
function shiftFor(at){
 const mid=Math.floor((at+KST)/DAY)*DAY-KST;
 const options=[
  {start:mid+6*HOUR,end:mid+12*HOUR,label:'오전반'},
  {start:mid+13*HOUR,end:mid+21*HOUR,label:'오후반'},
  {start:mid+DAY+6*HOUR,end:mid+DAY+12*HOUR,label:'오전반'}
 ];
 return options.find(s=>at<s.end)||options[2];
}
function moveSeconds(v){
 const meters=random(v,300,800),speed=random(v,15,25);
 return Math.max(30,Math.ceil(meters*3.6/speed)+random(v,20,60));
}
function stop(s,v,first){
 const alight=first?0:random(v,0,v.onboard);
 v.onboard-=alight;s.completed+=alight;v.alighted+=alight;
 const waiting=random(v,0,10);
 const boarded=random(v,0,Math.min(waiting,CAPACITY-v.onboard));
 v.onboard+=boarded;v.waiting=waiting;
 v.lastBoarded=boarded;v.lastAlighted=alight;v.boarded+=boarded;v.gross+=boarded*FARE;
}
function advance(s,now){
 if(!valid(s)||!Number.isSafeInteger(now)||now<=s.lastAt)return {changed:false,settlements:[]};
 // Cap offline replay to 7 real days, avoiding years of heavy synchronous work.
 const from=Math.max(s.lastAt,now-7*DAY),settlements=[];
 let changed=false;
 for(const v of s.vehicles){
  let cursor=Math.max(from,v.createdAt),steps=0;
  while(cursor<=now&&steps++<5000){
   if(v.phase==='idle'){
    if(!v.enabled)break;
    const shift=shiftFor(cursor);
    if(shift.start>now)break;
    cursor=Math.max(cursor,shift.start);
    v.shiftEnd=shift.end;v.shiftLabel=shift.label;
    v.phase='running';v.gross=0;v.boarded=0;v.alighted=0;v.onboard=0;
    stop(s,v,true);
    v.nextAt=Math.min(v.shiftEnd,cursor+moveSeconds(v));
    changed=true;
   }else if(v.phase==='running'){
    if(v.nextAt>now)break;
    cursor=v.nextAt;
    if(cursor>=v.shiftEnd){
     // 12:00 / 21:00 is the LAST stop departure, not settlement time.
     v.phase='returning';v.nextAt=cursor+moveSeconds(v);changed=true;
    }else{
     stop(s,v,false);
     v.nextAt=Math.min(v.shiftEnd,cursor+moveSeconds(v));
     changed=true;
    }
   }else if(v.phase==='returning'){
    if(v.nextAt>now)break;
    cursor=v.nextAt;
    // Everyone remaining alights at the terminal/depot without another fare.
    s.completed+=v.onboard;v.alighted+=v.onboard;v.lastAlighted=v.onboard;
    v.onboard=0;v.waiting=0;
    const payout=Math.floor(v.gross*rate(s)/100);
    settlements.push({id:v.id,at:cursor,payout,gross:v.gross,
     boarded:v.boarded,alighted:v.alighted,shift:v.shiftLabel});
    v.lastSettlement=payout;v.lastSettlementAt=cursor;v.finishedShifts++;
    v.phase='idle';v.nextAt=0;v.shiftEnd=0;v.shiftLabel='';
    v.gross=0;v.boarded=0;v.alighted=0;
    changed=true;
   }
  }
 }
 s.lastAt=now;
 return {changed,settlements};
}
function addVehicle(s,now){
 if(!valid(s)||s.vehicles.length>=MAX_VEHICLES)return null;
 const v=vehicle(s.nextId++,'new',now);
 s.vehicles.push(v);return v;
}
root.MYON_BUS_ENGINE=Object.freeze({
 CAPACITY,FARE,PRICE,TARGET,MAX_VEHICLES,REVENUE_UNLOCK_PRICE,
 initial,valid,rate,advance,addVehicle,shiftFor
});
})(window);
