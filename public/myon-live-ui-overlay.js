/* MYON LIVE: presentation-only UI Rion menu enhancement.
 * Reads the original MYON_LIVE_MISSIONS_V1 save; never mutates gameplay or saves.
 */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('server')!=='live')return;
const HOUR=3600000,MINUTE=60000;
const UPGRADE_CUTOFF=Date.parse('2026-11-23T13:53:18.000Z');
let nav=null,button=null,shell=null,panel=null,path=[],definitions=[],categories=[],isOpen=false,lastFingerprint='',cachedWorld=null;
const $=id=>document.getElementById(id);
const folderIcon='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/></svg>';
const fileIcon='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l5 5v13H6zM14 3v5h5M9 13h7"/></svg>';
function savedWorld(){
 try{
  const s=localStorage.getItem('MYON_LIVE_MISSIONS_V1');
  const v=s?JSON.parse(s):null;
  return v&&v.schema===1&&Array.isArray(v.rions?.discovered)?v:null;
 }catch{return null}
}
function findUi(world){
 return world?.rions?.discovered?.find(x=>x?.id==='rion.role.ui'||x?.id==='rion.role.user')||null;
}
function status(world,now){
 // Previously discovered LIVE Rions remain immediately available on upgrade.
 const ui=world?.uiRion;
 if(findUi(world)||ui?.phase==='done')return {visible:true,ready:true,ratio:1};
 if(ui?.phase!=='active')return {visible:false,ready:false,ratio:0};
 const elapsed=Math.max(0,now-ui.acceptedAt);
 return {visible:elapsed>=40*MINUTE,ready:false,
  ratio:Math.min(1,Math.max(0,(elapsed-40*MINUTE)/(10*MINUTE)))};
}
function nodeTree(world){
 const root={id:'root',name:'리온',children:[]};
 const labels={system:'시스템 리온',field:'분야 리온',style:'성향 리온',material:'소재 리온'};
 const byId=new Map(definitions.map(x=>[x.id,x]));
 for(const discovery of world?.rions?.discovered||[]){
  const id=discovery.id==='rion.role.user'?'rion.role.ui':discovery.id==='rion.role.encyclopedia'?'rion.role.wiki':discovery.id;
  const r=byId.get(id);if(!r||!labels[r.kind])continue;
  let type=root.children.find(x=>x.id===r.kind);
  if(!type){type={id:r.kind,name:labels[r.kind],children:[]};root.children.push(type)}
  let parent=type;
  if(r.kind==='field'){
   const idx=Math.floor(r.legacyFieldIndex/10),name=categories[idx]||'기타';
   let group=parent.children.find(x=>x.id==='field:'+idx);
   if(!group){group={id:'field:'+idx,name,children:[]};parent.children.push(group)}
   parent=group;
  }
  parent.children.push({id,name:r.name,kind:r.kind,discovery});
 }
 return root;
}
function size(node){return node.children?node.children.reduce((n,c)=>n+size(c),0):1}
function elem(tag,cls,txt){
 const v=document.createElement(tag);if(cls)v.className=cls;
 if(txt!==undefined)v.textContent=txt;
 return v;
}
function redraw(world){
 if(!panel||panel.hidden||!definitions.length)return;
 const directory=nodeTree(world);
 let current=directory;const levels=[directory];
 for(const id of path){
  const next=current.children?.find(x=>x.id===id);
  if(!next){path=[];current=directory;levels.length=1;break}
  current=next;levels.push(next);
 }
 const heading=$('mw-live-ui-page-title'),count=$('mw-live-ui-page-count'),crumbs=$('mw-live-ui-crumbs'),items=$('mw-live-ui-items');
 heading.textContent=current.name;count.textContent=size(current)+'종';
 crumbs.replaceChildren();items.replaceChildren();
 levels.forEach((entry,i)=>{
  if(i)crumbs.append(elem('span','mw-live-ui-crumb-arrow','›'));
  const b=elem('button','mw-live-ui-crumb',entry.name);b.type='button';
  b.disabled=i===levels.length-1;
  b.addEventListener('click',()=>{path=path.slice(0,i);redraw(savedWorld())});
  crumbs.append(b);
 });
 if(current.children){
  for(const child of current.children){
   const b=elem('button','mw-live-ui-entry');b.type='button';
   const img=elem('span','mw-live-ui-icon');img.innerHTML=child.children?folderIcon:fileIcon;
   const copy=elem('span','mw-live-ui-copy');
   copy.append(elem('strong','',child.name),elem('small','',child.children?'발견한 리온 '+size(child)+'종':'발견 완료'));
   const end=elem('span','mw-live-ui-end',child.children?size(child)+'종   ›':'발견   ›');
   b.append(img,copy,end);
   b.addEventListener('click',()=>{path.push(child.id);redraw(savedWorld());panel.scrollTop=0});
   items.append(b);
  }
 }else{
  const card=elem('article','mw-live-ui-detail');
  card.append(elem('h3','',current.name),elem('p','mw-live-ui-found','발견 완료 · R.0'));
  const wiki=world?.rions?.discovered?.some(x=>x.id==='rion.role.wiki'||x.id==='rion.role.encyclopedia');
  card.append(elem('p','mw-live-ui-muted',wiki?current.id:'자세한 정보는 위키 리온 발견 후 열람할 수 있습니다.'));
  items.append(card);
 }
}
function showPage(value){
 if(!shell||!panel)return;
 if(value&&!status(savedWorld(),Date.now()).ready)return;
 isOpen=value;panel.hidden=!value;
 shell.classList.toggle('mw-live-ui-open',value);
 if(value){path=[];redraw(savedWorld());panel.scrollTop=0}
 if(button)button.setAttribute('aria-pressed',value?'true':'false');
}
async function loadDirectory(){
 try{
  const [r,c]=await Promise.all([
   fetch('./myon-live-ui-registry.json',{cache:'no-store'}),
   fetch('./myon-live-ui-baseline.json',{cache:'no-store'})]);
  if(!r.ok||!c.ok)throw Error('리온 목록 자료를 불러오지 못했습니다.');
  const [reg,base]=await Promise.all([r.json(),c.json()]);
  if(reg.schema!==1||!Array.isArray(reg.records)||reg.records.length!==162||!Array.isArray(base.domains))throw Error('정식 리온 등록부 형식 오류');
  definitions=reg.records;categories=base.domains.map(x=>x.name);
  if(isOpen)redraw(savedWorld());
 }catch(e){if(panel){const list=$('mw-live-ui-items');if(list)list.textContent=String(e.message||e)}}
}
function attach(){
 const n=$('mw-rion-nav'),b=$('mw-rion-tab'),r=$('mw-root');
 if(!n||!b||!r||r.hidden)return false;
 nav=n;button=b;shell=r.parentElement;
 const wrap=elem('div','mw-live-ui-wrap');b.parentElement.insertBefore(wrap,b);wrap.append(b);
 b.replaceChildren();const label=elem('span','mw-live-ui-label');
 label.append(elem('span','mw-live-ui-tab-name','메뉴 세팅중'),
  elem('span','mw-live-ui-tab-lock','잠김'),elem('span','mw-live-ui-tab-arrow','›'));
 b.append(label);
 const main=elem('main','mw-live-ui-page');main.id='mw-live-ui-page';main.hidden=true;
 const header=elem('div','mw-live-ui-head');
 header.append(elem('h2','', '리온'),elem('span','mw-live-ui-total',''));
 const close=elem('button','mw-live-ui-close','닫기');close.type='button';
 close.addEventListener('click',()=>showPage(false));
 header.append(close);
 main.append(header);
 const pageHead=elem('div','mw-live-ui-page-head');
 const title=elem('h3','', '리온');title.id='mw-live-ui-page-title';
 const total=elem('span','', '');total.id='mw-live-ui-page-count';
 pageHead.append(title,total);main.append(pageHead);
 const crumbs=elem('nav','mw-live-ui-crumbs');crumbs.id='mw-live-ui-crumbs';crumbs.setAttribute('aria-label','리온 폴더 경로');main.append(crumbs);
 const items=elem('div','mw-live-ui-items');items.id='mw-live-ui-items';main.append(items);
 shell.insertBefore(main,nav);panel=main;
 button.addEventListener('click',event=>{
  event.preventDefault();
  event.stopImmediatePropagation();
  if(!button.disabled)showPage(!isOpen);
 },true);
 cachedWorld=savedWorld();
 loadDirectory();
 window.setInterval(()=>{cachedWorld=savedWorld();if(isOpen){const fingerprint=JSON.stringify(cachedWorld?.rions?.discovered?.map(x=>x.id)||[]);if(fingerprint!==lastFingerprint)redraw(cachedWorld)}},1000);
 return true;
}
function paint(){
 if(!button||!shell||!nav)return;
 const world=cachedWorld,state=status(world,Date.now());
 nav.hidden=!state.visible;
 nav.style.display=state.visible?'flex':'none';
 if(!state.visible){if(isOpen)showPage(false);return}
 button.disabled=!state.ready;
 button.style.width=state.ratio*100+'%';
 button.classList.toggle('mw-live-ui-assembling',state.ratio<1);
 button.classList.toggle('mw-live-ui-locked',state.ratio>=1&&!state.ready);
 button.classList.toggle('mw-live-ui-ready',state.ready);
 const name=button.querySelector('.mw-live-ui-tab-name');
 const lock=button.querySelector('.mw-live-ui-tab-lock');
 const arrow=button.querySelector('.mw-live-ui-tab-arrow');
 if(name)name.textContent=state.ratio<1?'메뉴 세팅중':'리온';
 if(lock)lock.hidden=state.ratio<1||state.ready;
 if(arrow)arrow.hidden=!state.ready;
 button.setAttribute('aria-label',state.ready?'리온 메뉴 열기':state.ratio<1?'리온 메뉴 세팅 중':'리온 메뉴 잠김');
 const px=(button.parentElement?.getBoundingClientRect().width||0)*state.ratio;
 button.style.setProperty('--ui-scale',String(Math.min(1,Math.max(0,px/90))));
 button.style.setProperty('--ui-opacity',String(Math.min(1,px/28)));
 const fingerprint=JSON.stringify(world?.rions?.discovered?.map(x=>x.id)||[]);
 if(isOpen&&fingerprint!==lastFingerprint)redraw(world);
 lastFingerprint=fingerprint;
}
function animation(){
 if(!document.body.contains(button))return;
 paint();window.requestAnimationFrame(animation);
}
let tries=0;
const interval=window.setInterval(()=>{
 if(attach()){
  window.clearInterval(interval);
  if(typeof window.requestAnimationFrame==='function')window.requestAnimationFrame(animation);
  else window.setInterval(paint,250);
 }else if(++tries>=240)window.clearInterval(interval);
},250);
})();
