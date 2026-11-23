/* Read-only new-release notice: DEV tracks new DEV builds; official follows ONLY approved pins. */
(function(){
'use strict';
const params=new URLSearchParams(location.search);
const server=params.get('server'),revision=(params.get('build')||'').toLowerCase();
const devVersion=params.get('dev_version')||'';
if(!['dev','live','test'].includes(server)||!/^[a-f0-9]{40}$/.test(revision))return;
if(server==='dev'&&!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(devVersion))return;
const panel=document.getElementById('mw-update-reveal');
if(!panel)return;
const rolloutUrl=new URL('../../myon-rollouts.json',location.href);
const approvedUrl=new URL('../../myon-approved-releases.json',location.href);
let ready=false,checking=false;
function newerVersion(next,current){
 const nextParts=next.split('.').map(Number),oldParts=current.split('.').map(Number);
 for(let i=0;i<4;i++){
  if((nextParts[i]||0)>(oldParts[i]||0))return true;
  if((nextParts[i]||0)<(oldParts[i]||0))return false;
 }
 return false;
}
function reveal(){
 if(ready)return;
 ready=true;
 panel.hidden=false;
 void panel.offsetHeight;
 panel.classList.add('is-revealed');
}
async function fetchJson(url){
 const next=new URL(url.href);
 next.searchParams.set('at',String(Date.now()));
 const response=await fetch(next.href,{cache:'no-store'});
 return response.ok?response.json():null;
}
async function check(){
 if(ready||checking)return;
 // Development Rion gates official notices; DEV notices are unconditional.
 if(server!=='dev'&&window.MYON_RION_IS_DISCOVERED?.('rion.role.development')!==true)return;
 checking=true;
 try{
  const data=await fetchJson(rolloutUrl);
  const releases=data?.releases;
  if(data?.schema!==1||!Array.isArray(releases)||!releases.length
   ||!releases.every(r=>r&&/^[a-f0-9]{40}$/.test(r.revision)&&/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(r.version)))return;
  if(server==='dev'){
   const latest=releases[releases.length-1];
   if(latest.revision!==revision&&newerVersion(latest.version,devVersion))reveal();
   return;
  }
  // Latest development commits are never treated as official approvals.
  const approved=await fetchJson(approvedUrl);
  const pin=approved?.[server];
  const current=releases.find(r=>r.revision===revision);
  if(approved?.schema!==1||!pin||!current||!/^[a-f0-9]{40}$/.test(pin.revision)
    ||!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(pin.version))return;
  if(pin.revision!==revision&&releases.some(r=>r.revision===pin.revision&&r.version===pin.version)
    &&newerVersion(pin.version,current.version))reveal();
 }catch(error){console.warn('MYON update notice check unavailable',error)}
 finally{checking=false}
}
window.MYON_RION_CHECK_UPDATE=check;
window.setTimeout(check,1200);
window.setInterval(check,60000);
})();
