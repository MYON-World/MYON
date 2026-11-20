/* DEV-only, full-row folder navigator. Does not alter Rion progression or saves. */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('server')!=='dev')return;
const css=String.raw`
#mw-root.myon-folder-wide{width:100%;max-width:none}
#mw-root.myon-folder-wide .mw-rion-view{padding:12px clamp(12px,2vw,34px) 26px}
.mf{color:#eff8ff;font:12px Inter,"Pretendard Variable","Noto Sans KR",sans-serif}
.mf-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px}
.mf-title h2{font-size:20px;margin:3px 0}.mf-eyebrow{font-size:10px;font-weight:700;letter-spacing:.17em;color:#85bed9}
.mf-tag{font-size:10px;color:#9cbdd1;border:1px solid #416781;background:#10334b;padding:5px 8px;border-radius:5px}
.mf-frame{background:linear-gradient(160deg,rgba(15,37,56,.92),rgba(7,22,36,.91));border:1px solid #335770;border-radius:11px;overflow:hidden}
.mf-route{display:flex;gap:7px;align-items:center;padding:10px 12px;border-bottom:1px solid #34546a;min-height:44px;flex-wrap:wrap}
.mf-back{padding:6px 11px;border:1px solid #486b82;border-radius:7px;background:#1b394d;color:#d5ebf8;border-radius:7px;font-size:11px}
.mf-back:disabled{opacity:.35;cursor:default}
.mf-crumbs{display:flex;align-items:center;gap:1px;flex-wrap:wrap;min-width:0;flex:1}
.mf-crumb{background:transparent;border:0;color:#9dbacc;font-size:11px;padding:6px 7px;border-radius:6px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mf-crumb[aria-current=page]{color:#effaff;font-weight:750;background:#1b3b52}
.mf-sep{color:#658ba3;font-size:13px}.mf-current{color:#8eafc4;font-size:10px}
.mf-search{border-bottom:1px solid #2c4e64;padding:10px 12px;display:flex;align-items:center;gap:9px;background:#0a2033}
.mf-search input{background:transparent;color:#eff8ff;border:0;outline:none;min-width:0;width:100%;font-size:12px;height:26px}.mf-search input::placeholder{color:#7294ab}
.mf-clear{border:0;border-radius:6px;color:#b7d4e6;background:#1a3b50;padding:5px 9px;font-size:11px}
.mf-content{padding:15px;min-height:310px}
.mf-section{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.mf-section strong{color:#d8ecf8;font-size:12px}.mf-section small{color:#80a6c0;font-size:11px}
.mf-list{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;width:100%}
.mf-folder{width:100%;min-height:64px;border-radius:9px;border:1px solid #3c617a;background:linear-gradient(145deg,#173449,#10293c);color:#e5f5ff;padding:12px 16px;text-align:left;display:flex;align-items:center;gap:14px}
.mf-folder:hover{border-color:#7ac4e2;background:linear-gradient(145deg,#214761,#16364e)}
.mf-icon{display:grid;place-items:center;flex:0 0 30px;color:#a0d9ec}
.mf-icon svg{width:25px;height:25px}
.mf-text{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:1;min-width:0}
.mf-text strong{font-size:12px;overflow-wrap:anywhere}.mf-text small{color:#779eb5;font-size:10px;white-space:nowrap}
.mf-folder.leaf{min-height:59px;background:linear-gradient(140deg,#112c40,#0c2235);border-color:#31546e}
.mf-folder.leaf .mf-icon{color:#9bd9c4}.mf-folder.leaf:hover{border-color:#77b9c5;background:#163c4f}.mf-folder.leaf strong{font-size:13px}
.mf-level{color:#9fdac9!important;border:1px solid #47796d;background:#1a4943;padding:2px 5px;border-radius:4px}
.mf-level.locked{color:#91a7b9!important;border-color:#36556a;background:#1b3345}
.mf-detail{background:#112b40;border:1px solid #3d647c;border-radius:9px;padding:17px;display:flex;flex-direction:column;gap:16px}
.mf-detail h3{margin:4px 0 0;font-size:22px}.mf-detail-caption{font-size:11px;color:#a0bed2}
.mf-detail-head{display:flex;align-items:start;justify-content:space-between;gap:10px}
.mf-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.mf-fact{min-width:0;background:#0d2437;border:1px solid #2c5068;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:7px}
.mf-fact span{font-size:10px;color:#8caabc}.mf-fact strong{font-size:13px;color:#e7f6ff}
.mf-note{border-top:1px solid #36546b;padding-top:11px;color:#98b6ca;font-size:11px;line-height:1.7}
.mf-empty{padding:50px;text-align:center;color:#9bb6c8;font-size:12px}
@media(max-width:760px){.mf-content{padding:11px}.mf-facts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.mf-folder{min-height:59px;padding:10px 12px;gap:12px}.mf-folder.leaf{min-height:56px}.mf-text strong{font-size:12px}.mf-crumb{max-width:120px}.mf-detail{padding:13px}}
`;
const style=document.createElement('style');style.textContent=css;document.head.append(style);
const F='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/></svg>';
const R='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 2.5 20 7v10l-8 4.5L4 17V7z"/><path d="m4 7 8 4.5L20 7M12 11.5v10"/></svg>';
let category=null,rion=null,query='';
const e=(tag,cl,text)=>{const el=document.createElement(tag);if(cl)el.className=cl;if(text!==undefined)el.textContent=text;return el;};
function render(view,opts){
 const groups=new Map();
 for(const item of opts.catalog)if(!groups.has(item.category))groups.set(item.category,[]);
 for(const r of opts.definitions){
  const name=r.kind==='field'?(opts.catalog[r.legacyFieldIndex]?.category||'기타 분야'):r.kind==='system'?'시스템 리온':'성향 리온';
  if(!groups.has(name))groups.set(name,[]);
  groups.get(name).push(r);
 }
 const categories=[...groups].map(([name,items])=>({name,items}));
 const all=opts.definitions;
 if(category&&!groups.has(category))category=null;
 if(rion&&!all.some(x=>x.id===rion))rion=null;
 view.replaceChildren();
 const wrap=e('div','mf'),heading=e('div','mf-title'),title=e('div');
 title.append(e('span','mf-eyebrow','MYON WORLD / RION'),e('h2','','리온'));
 heading.append(title,e('span','mf-tag','가로 전체 폴더형'));wrap.append(heading);
 const frame=e('section','mf-frame');frame.setAttribute('aria-label','리온 폴더형 탐색기');
 const route=e('div','mf-route'),back=e('button','mf-back','← 이전');back.type='button';
 back.onclick=()=>{if(query)query='';else if(rion)rion=null;else category=null;render(view,opts);};route.append(back);
 const crumbs=e('nav','mf-crumbs');crumbs.setAttribute('aria-label','현재 경로');
 const crumb=(label,fn,selected)=>{const b=e('button','mf-crumb',label);b.type='button';if(selected)b.setAttribute('aria-current','page');b.onclick=fn;return b;};
 crumbs.append(crumb('전체 리온',()=>{category=null;rion=null;query='';render(view,opts)},!category));
 if(category){crumbs.append(e('span','mf-sep','›'),crumb(category,()=>{rion=null;query='';render(view,opts)},!rion));}
 if(rion){const one=all.find(x=>x.id===rion);if(one)crumbs.append(e('span','mf-sep','›'),crumb(one.name,()=>{},true));}
 route.append(crumbs,e('span','mf-current',query?'검색':rion?'상세':category?'리온 선택':'대분류'));
 frame.append(route);
 const sr=e('div','mf-search'),inp=e('input',''),clear=e('button','mf-clear','지우기');
 inp.type='search';inp.value=query;inp.placeholder='리온 검색 (전체 분야)';inp.setAttribute('aria-label','리온 검색');
 clear.type='button';clear.onclick=()=>{query='';inp.value='';update();inp.focus();};
 const mag=e('span','', '⌕');mag.style.cssText='font-size:22px;color:#8eafc5;line-height:1';
 sr.append(mag,inp,clear);frame.append(sr);
 const content=e('div','mf-content');frame.append(content);wrap.append(frame);view.append(wrap);
 const section=(title,count)=>{const el=e('div','mf-section');el.append(e('strong','',title),e('small','',count));content.append(el);};
 const navigate=(c,r)=>{category=c;rion=r;query='';render(view,opts);};
 const tile=(item,isFolder,fn)=>{
  const btn=e('button','mf-folder'+(isFolder?'':' leaf'));btn.type='button';btn.setAttribute('aria-label',item.name+' 열기');
  const ico=e('span','mf-icon');ico.innerHTML=isFolder?F:R;btn.append(ico);
  const line=e('span','mf-text');line.append(e('strong','',item.name));
  if(isFolder)line.append(e('small','',item.items.length+'개'));
  else {const discovered=opts.isDiscovered(item.id);line.append(e('small','mf-level'+(discovered?'':' locked'),discovered?'R.0':'미발견'));}
  btn.append(line);btn.onclick=fn;return btn;
 };
 function update(){
  content.replaceChildren();const q=query.trim().toLocaleLowerCase('ko-KR');clear.hidden=!q;back.disabled=!category&&!q;
  const list=e('div','mf-list');
  if(q){
   const results=all.filter(x=>x.name.toLocaleLowerCase('ko-KR').includes(q)||categories.some(cat=>cat.name.toLocaleLowerCase('ko-KR').includes(q)&&cat.items.some(i=>i.id===x.id)));
   section('검색 결과',results.length+'개');
   for(const item of results)list.append(tile(item,false,()=>navigate(categories.find(c=>c.items.some(y=>y.id===item.id))?.name||null,item.id)));
   content.append(results.length?list:e('div','mf-empty','검색 결과가 없습니다.'));return;
  }
  if(rion){
   const item=all.find(x=>x.id===rion);if(!item){rion=null;update();return;}
   section('리온 관리','');
   const block=e('section','mf-detail'),head=e('div','mf-detail-head'),left=e('div'),found=opts.isDiscovered(item.id);
   left.append(e('span','mf-detail-caption',category||'리온'),e('h3','',item.name));
   head.append(left,e('span','mf-level'+(found?'':' locked'),found?'리온 0':'미발견'));block.append(head);
   const facts=e('div','mf-facts');
   for(const [key,val] of [['리온 단계',found?'0':'미발견'],['관리 시설','통합 관리'],['상태',found?'발견 완료':'미발견']]){
    const cell=e('div','mf-fact');cell.append(e('span','',key),e('strong','',val));facts.append(cell);
   }
   block.append(facts,e('div','mf-note','선택한 리온을 관리하는 공통 화면입니다. 생산·거래 기능은 아직 연결되지 않았습니다.'));
   content.append(block);return;
  }
  if(category){
   const cat=categories.find(c=>c.name===category);
   if(!cat){category=null;update();return;}
   section(cat.name+' / 세부 리온',cat.items.length+'개');
   for(const item of cat.items)list.append(tile(item,false,()=>navigate(cat.name,item.id)));
   content.append(list);return;
  }
  section('산업 대분류',categories.length+'개 폴더');
  for(const cat of categories)list.append(tile(cat,true,()=>navigate(cat.name,null)));
  content.append(list);
 }
 inp.oninput=()=>{query=inp.value;update();};
 update();
}
window.MYON_DEV_FOLDER_UI=Object.freeze({render});
})();