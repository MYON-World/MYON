// MYON v0.13.52 — compact Bus World dashboard, no save access.
(function(root){
'use strict';
const $=id=>document.getElementById(id);
let handlers=null,lastSignature='';
function init(callbacks){handlers=callbacks;}
function draw(s,{rate,funds,busy,ready,format,engine}){
 if(!s)return;
 const fleet=s.vehicles,onboard=fleet.reduce((n,v)=>n+v.onboard,0);
 const gross=fleet.reduce((n,v)=>n+v.gross,0);
 const projected=fleet.reduce((n,v)=>n+Math.floor(v.gross*rate/100),0);
 const target=engine.TARGET;
 $('bus-level-count').textContent=s.completed.toLocaleString('ko-KR')+' / '+target.toLocaleString('ko-KR')+'명';
 $('bus-level-progress').style.width=Math.min(100,s.completed/target*100).toFixed(2)+'%';
 $('bus-level-note').textContent=s.completed>=target?'목표 달성 · LV.1 계속 운영 가능':'목표까지 '+(target-s.completed).toLocaleString('ko-KR')+'명';
 $('bus-fleet-count').textContent='운행 차량 '+fleet.length+' / 100대';
 $('bus-onboard').textContent=onboard+' / '+(fleet.length*engine.CAPACITY)+'명';
 $('bus-gross').textContent=format(gross);
 $('bus-pending').textContent=format(projected);
 $('bus-rate').textContent=rate+'%';
 const buy=$('bus-purchase'),unlock=$('bus-revenue-buy');
 buy.disabled=!ready||busy||fleet.length>=engine.MAX_VEHICLES||funds<engine.PRICE;
 buy.textContent=fleet.length>=engine.MAX_VEHICLES?'보유 한도 100대':'MYON 솔라티 구매 · '+format(engine.PRICE);
 unlock.disabled=!ready||busy||rate>=100||funds<engine.REVENUE_UNLOCK_PRICE;
 unlock.textContent=rate>=100?'해금 완료 · 100%':'수익률 +1%p · '+format(engine.REVENUE_UNLOCK_PRICE);
 const signature=fleet.map(v=>[v.id,v.phase,v.enabled,v.onboard,v.waiting,v.gross,v.lastBoarded,v.lastAlighted,v.lastSettlementAt].join(':')).join('|')+'|'+busy;
 if(signature===lastSignature)return;
 lastSignature=signature;
 const fragment=document.createDocumentFragment();
 for(const v of fleet){
  const row=document.createElement('div');row.className='bus-vehicle-row';
  const info=document.createElement('div');info.className='bus-vehicle-copy';
  const title=document.createElement('strong');
  title.textContent='솔라티 '+v.id+'호 · '+(v.phase==='running'?'운행 중':v.phase==='returning'?'차고지 복귀 중':v.enabled?'다음 근무 대기':'배차 중지');
  const detail=document.createElement('small');
  detail.textContent=v.phase==='idle'?'최근 정산 '+format(v.lastSettlement):
   '탑승 '+v.onboard+'/15 · 대기 '+v.waiting+' · 하차 '+v.lastAlighted+' / 승차 '+v.lastBoarded+' · 매출 '+format(v.gross);
  info.append(title,detail);
  const toggle=document.createElement('button');toggle.type='button';toggle.className='slot-button';
  toggle.textContent=v.enabled?'운행 중지':'운행 재개';toggle.disabled=busy;
  toggle.addEventListener('click',()=>handlers&&handlers.onToggle(v.id));
  row.append(info,toggle);fragment.append(row);
 }
 $('bus-vehicle-list').replaceChildren(fragment);
}
root.MYON_BUS_UI={init,draw,refresh(){lastSignature=''}};
})(window);
