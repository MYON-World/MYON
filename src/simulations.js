/** Separate, non-economic demonstrations — not yet purchasable transport businesses. */
const rand=(a,b)=>a+Math.floor(Math.random()*(b-a+1))
export const RAIL_SEGMENTS = Object.freeze({
  wi:{name:'서역 → 중앙역',block:'서역 상행',duration:11},
  wo:{name:'중앙역 → 서역',block:'서역 하행',duration:11},
  ei:{name:'동역 → 중앙역',block:'동역 하행',duration:13},
  eo:{name:'중앙역 → 동역',block:'동역 상행',duration:13},
  bi:{name:'지선역 → 중앙역',block:'지선 단선',duration:14},
  bo:{name:'중앙역 → 지선역',block:'지선 단선',duration:14},
})
const clone=o=>JSON.parse(JSON.stringify(o))
function rlog(sim,message){sim.logs.unshift(message);sim.logs=sim.logs.slice(0,7)}
const blockBusy=(sim,seg,id=null)=>sim.trains.some(t=>t.id!==id&&t.phase==='moving'&&RAIL_SEGMENTS[t.seg].block===RAIL_SEGMENTS[seg].block)
function spawnRail(sim,origin,forceCompound=false){
  if(sim.trains.length>=9)return false
  const seg=origin==='W'?'wi':origin==='E'?'ei':'bi'
  if(blockBusy(sim,seg))return false
  sim.seq++
  const cars=origin==='W'?rand(4,8):rand(1,3)
  sim.trains.push({id:`MR${sim.seq}`,cars,origin,direction:origin==='W'?'상행':'하행',phase:'moving',seg,age:0,goal:null,mode:origin==='W'&&(forceCompound||Math.random()<.6)?'compound':origin==='W'?'regular':'return'})
  rlog(sim,`MR${sim.seq} ${origin==='W'?'상행':'하행'} ${cars}량 출발`)
  return true
}
export function createRailDemo(){
  const s={seconds:0,seq:100,trains:[],splits:0,joins:0,arrivals:0,logs:[],nextSpawn:9}
  spawnRail(s,'W',true);spawnRail(s,'E');spawnRail(s,'B');return s
}
function addAtJ(sim,cars,direction,goal,origin,id){
  sim.trains.push({id:id||`MR${++sim.seq}`,cars,origin,direction,phase:'junction',seg:null,age:0,goal,mode:'depart'})
}
export function advanceRailDemo(state){
  const s=clone(state);s.seconds++
  for(const t of [...s.trains]){
    if(!s.trains.includes(t))continue
    if(t.phase==='junction'){t.age++;continue}
    const seg=RAIL_SEGMENTS[t.seg]
    t.age=Math.min(seg.duration,t.age+1)
    if(t.age<seg.duration)continue
    const inbound=['wi','ei','bi'].includes(t.seg)
    if(inbound){
      if(s.trains.filter(x=>x.phase==='junction').length>=5)continue
      const idx=s.trains.indexOf(t)
      if(t.seg==='wi'){
        if(t.mode==='compound'){
          const carsA=Math.floor(t.cars/2),carsB=t.cars-carsA
          if(s.trains.filter(x=>x.phase==='junction').length>=4)continue
          s.trains.splice(idx,1)
          addAtJ(s,carsA,'상행','eo','W',t.id+'A')
          addAtJ(s,carsB,'상행','bo','W',t.id+'B')
          s.splits++;rlog(s,`${t.id} 중앙역 분리 → 동역 ${carsA}량 / 지선 ${carsB}량`)
        }else{
          t.phase='junction';t.age=0;t.goal=Math.random()<.5?'eo':'bo';t.seg=null;t.mode='depart'
          rlog(s,`${t.id} 중앙역 정차 · 진로 설정`)
        }
      }else{
        t.phase='junction';t.age=0;t.origin=t.seg==='ei'?'E':'B';t.mode='join';t.seg=null;t.goal='wo'
        rlog(s,`${t.id} 중앙역 도착 · 하행 연결 대기`)
      }
    }else{
      s.trains.splice(s.trains.indexOf(t),1);s.arrivals++;rlog(s,`${t.id} ${seg.name.split(' → ')[1]} 도착`)
    }
  }
  const east=s.trains.find(t=>t.phase==='junction'&&t.mode==='join'&&t.origin==='E'&&t.age>=2)
  const branch=s.trains.find(t=>t.phase==='junction'&&t.mode==='join'&&t.origin==='B'&&t.age>=2)
  if(east&&branch&&east.cars+branch.cars<=10){
    s.trains=s.trains.filter(t=>t!==east&&t!==branch)
    addAtJ(s,east.cars+branch.cars,'하행','wo','J')
    s.joins++;rlog(s,`${east.id} + ${branch.id} 중앙역 연결 → 하행 ${east.cars+branch.cars}량`)
  }
  // Exit after waiting if a partner never arrives.
  for(const t of s.trains){if(t.phase==='junction'&&t.mode==='join'&&t.age>=30){t.mode='depart';t.goal='wo';rlog(s,`${t.id} 단독 하행 전환`)}}
  // One interlocked departure each tick. The single-track branch uses a shared block.
  const candidate=s.trains.find(t=>t.phase==='junction'&&t.mode==='depart'&&t.age>=4&&!blockBusy(s,t.goal))
  if(candidate){candidate.phase='moving';candidate.seg=candidate.goal;candidate.age=0;rlog(s,`${candidate.id} ${RAIL_SEGMENTS[candidate.seg].name} 출발`)}
  s.nextSpawn--
  if(s.nextSpawn<=0){const origin=['W','E','B'][rand(0,2)];s.nextSpawn=spawnRail(s,origin)?rand(8,13):3}
  return s
}
export function railBlockStatuses(sim){
  const keys=[['서역 상행','서역 → 중앙역'],['서역 하행','중앙역 → 서역'],['동역 상행','중앙역 → 동역'],['동역 하행','동역 → 중앙역'],['지선 단선','지선 양방향']]
  return keys.map(([id,label])=>({id,label,occupant:sim.trains.find(t=>t.phase==='moving'&&RAIL_SEGMENTS[t.seg].block===id)?.id||null}))
}
export const ATC_STAGES=Object.freeze([
 {id:'APP',label:'접근',seconds:12},
 {id:'TWR',label:'타워',seconds:8},
 {id:'RWY',label:'착륙',seconds:7},
 {id:'GND',label:'지상이동',seconds:11},
 {id:'GATE',label:'터미널',seconds:8},
])
function atcSpawn(s){
 if(s.flights.length>=7)return false
 const names=['MYN','KAL','AAR','JJA','TWB','JNA'];s.seq++
 const code=names[rand(0,names.length-1)]+String(rand(101,998))
 s.flights.push({id:s.seq,code,stage:0,age:0,gate:rand(1,12)})
 rlog(s,`${code} 접근 관제 진입`);return true
}
export function createAtcDemo(){const s={seconds:0,seq:0,flights:[],arrivals:0,nextSpawn:8,logs:[]};atcSpawn(s);atcSpawn(s);return s}
export function advanceAtcDemo(old){
 const s=clone(old);s.seconds++
 for(const f of [...s.flights]){
   const stage=ATC_STAGES[f.stage];f.age=Math.min(stage.seconds,f.age+1)
   if(f.age<stage.seconds)continue
   if(f.stage===1 && s.flights.some(x=>x.id!==f.id&&x.stage===2))continue
   if(f.stage===4){s.arrivals++;s.flights=s.flights.filter(x=>x.id!==f.id);rlog(s,`${f.code} 터미널 도착 · G${f.gate}`);continue}
   f.stage++;f.age=0;rlog(s,`${f.code} ${ATC_STAGES[f.stage].label} 단계 진입`)
 }
 s.nextSpawn--
 if(s.nextSpawn<=0)s.nextSpawn=atcSpawn(s)?rand(10,15):4
 return s
}
