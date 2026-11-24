/* Read-only new-release notice: LIVE follows the deployed main commit; TEST stays pinned. */
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
 if(server==='test'&&window.MYON_RION_IS_DISCOVERED?.('rion.role.development')!==true)return;
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
  // LIVE follows the newest successfully published main commit, never an older fixed pin.
  if(server==='live'){
   const latest=releases[releases.length-1];
   const current=releases.find(r=>r.revision===revision);
   if(!current||latest.revision===revision||!newerVersion(latest.version,current.version))return;
   // Confirm the actual LIVE page exists before notifying anyone to restart.
   const file=new URL('../../releases/'+latest.revision+'/myon-live-ui.html',location.href);
   const response=await fetch(file.href,{method:'HEAD',cache:'no-store'});
   if(response.ok)reveal();
   return;
  }
  // Retired TEST alone continues to follow its frozen approval.
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
