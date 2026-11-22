/* World Rion R0: DEV-only targeted site exploration and distances. */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('server')!=='dev')return;
const PAGE_SIZE=24;
let sourceIndex=0,page=0,selectedType='채광단지',lastResult='';
const style=document.createElement('style');
style.textContent=[
 '.mw-world-panel{box-sizing:border-box;width:100%;border:1px solid #3b607b;border-radius:9px;background:linear-gradient(150deg,#10263a,#0b1c2c);padding:15px 17px;margin-top:9px;color:#e5f5ff}',
 '.mw-world-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:11px}',
 '.mw-world-head h2{margin:0;font-size:17px}.mw-world-small{font-size:11px;color:#98b7c9;line-height:1.5}',
 '.mw-world-actions{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:8px 0 11px}',
 '.mw-world-search{display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding:10px 0 9px;border-top:1px solid #36536b;margin-top:12px}',
 '.mw-world-search select{background:#16364d;color:#e1f2fd;border:1px solid #52758e;border-radius:7px;padding:8px;font-size:12px;min-height:34px;flex:1;min-width:125px}',
 '.mw-world-result{font-size:12px;color:#a9d9ea;margin:2px 0 9px}',
 '.mw-world-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}',
 '.mw-world-site{display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #36556c;border-radius:7px;background:#102c40;padding:9px;min-width:0}',
 '.mw-world-site.is-source{border-color:#80bcd2;background:#1c4055}',
 '.mw-world-site-name{font-size:12px;font-weight:700;min-width:0;overflow-wrap:anywhere}',
 '.mw-world-distance{font-size:12px;color:#bde0f1;white-space:nowrap;font-variant-numeric:tabular-nums}',
 '.mw-world-site button{font-size:10px;border:1px solid #557b92;color:#d9f3ff;border-radius:5px;background:#173b52;padding:5px 7px;white-space:nowrap}',
 '.mw-world-count{font-size:12px;color:#a9c6d7;margin-top:12px}',
 '@media(max-width:740px){.mw-world-panel{padding:11px}.mw-world-list{grid-template-columns:1fr}.mw-world-head h2{font-size:15px}}'
].join('\n');
document.head.append(style);
function add(parent,tag,cls,text){
 const node=document.createElement(tag);if(cls)node.className=cls;
 if(text!==undefined)node.textContent=text;
 parent.append(node);return node;
}
function render(view,state,engine,onExplore){
 if(!engine.valid(state))return;
 const old=view.querySelector('.mw-world-panel');
 if(old)old.remove();
 sourceIndex=Math.min(sourceIndex,state.discoveredCount-1);
 const maxPage=Math.max(0,Math.ceil(state.discoveredCount/PAGE_SIZE)-1);
 page=Math.min(page,maxPage);
 const panel=add(view,'section','mw-world-panel');
 const head=add(panel,'div','mw-world-head');
 const heading=add(head,'div');
 add(heading,'h2',null,'월드 리온 · R0');
 add(heading,'p','mw-world-small','지도 없음 · 단지 위치 고정 · 모든 단지 간 거리 자동 계산');
 add(head,'span','mw-tag','발견');
 const source=engine.district(state,sourceIndex);
 add(panel,'p','mw-world-small','기준: '+source.name+' ('+source.id+') · 발견된 단지 '+state.discoveredCount.toLocaleString('ko-KR')+'곳');
 const search=add(panel,'div','mw-world-search');
 add(search,'label','mw-world-small','단지 종류');
 const select=add(search,'select');
 select.setAttribute('aria-label','탐색할 단지 종류');
 for(const type of engine.TYPES){
  const option=add(select,'option',null,type);
  option.value=type;
 }
 if(!engine.TYPES.includes(selectedType))selectedType=engine.TYPES[0];
 select.value=selectedType;
 select.addEventListener('change',()=>{selectedType=select.value});
 const find=add(search,'button','mw-button','선택 단지 탐색');
 find.type='button';find.disabled=state.discoveredCount>=engine.MAX_SITES;
 find.addEventListener('click',()=>{
  const result=onExplore(selectedType);
  if(!result)return;
  if(result.error){
   lastResult=result.error;
   render(view,state,engine,onExplore);
   return;
  }
  lastResult=result.foundCount>0
   ?selectedType+' '+result.foundCount+'곳 발견 · SITE-'+String(result.from+1).padStart(6,'0')+'부터'
   :selectedType+'를 발견하지 못했습니다. 다시 탐색할 수 있습니다.';
  if(result.foundCount>0)page=Math.floor(result.from/PAGE_SIZE);
  render(view,result.state,engine,onExplore);
 });
 add(panel,'p','mw-world-small','선택한 종류만 탐색합니다. 결과는 미발견(0곳), 1곳 또는 여러 곳일 수 있습니다.');
 if(lastResult)add(panel,'p','mw-world-result',lastResult);
 const list=add(panel,'div','mw-world-list');
 for(const site of engine.list(state,page*PAGE_SIZE,PAGE_SIZE)){
  const row=add(list,'div','mw-world-site'+(site.index===sourceIndex?' is-source':''));
  const name=add(row,'div');
  add(name,'div','mw-world-site-name',site.name);
  add(name,'div','mw-world-small',site.id);
  add(row,'span','mw-world-distance',engine.distance(state,sourceIndex,site.index).toLocaleString('ko-KR')+' km');
  const button=add(row,'button',null,site.index===sourceIndex?'기준':'선택');
  button.type='button';button.disabled=site.index===sourceIndex;
  button.addEventListener('click',()=>{sourceIndex=site.index;render(view,state,engine,onExplore)});
 }
 const actions=add(panel,'div','mw-world-actions');
 if(page>0){
  const prev=add(actions,'button','mw-button','이전 단지');prev.type='button';
  prev.addEventListener('click',()=>{page--;render(view,state,engine,onExplore)});
 }
 if(page<maxPage){
  const next=add(actions,'button','mw-button','다음 단지');next.type='button';
  next.addEventListener('click',()=>{page++;render(view,state,engine,onExplore)});
 }
 add(panel,'p','mw-world-count','발견한 단지는 건설이 아닌 자연 단지입니다. 기존 종류·거리·고유번호는 변하지 않습니다.');
}
window.MYON_DEV_WORLD_UI=Object.freeze({render});
})();
