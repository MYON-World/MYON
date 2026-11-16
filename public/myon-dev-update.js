/* Read-only DEV release detection. The portal alone exits/re-enters archived game pages. */
(function(){
'use strict';
const params=new URLSearchParams(location.search);
const revision=(params.get('build')||'').toLowerCase();
const version=params.get('dev_version')||'';
if(params.get('server')!=='dev'||!/^[a-f0-9]{40}$/.test(revision)||!/^\d+\.\d+\.\d+$/.test(version))return;
const panel=document.getElementById('mw-update-reveal');
if(!panel)return;
const manifestUrl=new URL('../../myon-rollouts.json',location.href);
let ready=false,checking=false;
function newerVersion(next,current){
 const nextParts=next.split('.').map(Number),oldParts=current.split('.').map(Number);
 for(let i=0;i<3;i++){
  if(nextParts[i]>oldParts[i])return true;
  if(nextParts[i]<oldParts[i])return false;
 }
 return false;
}
function reveal(){
 if(ready)return;
 ready=true;
 panel.hidden=false;
 void panel.offsetHeight; // Start collapsed so the panel can slide down.
 panel.classList.add('is-revealed');
}
async function check(){
 if(ready||checking)return;
 checking=true;
 try{
  const url=new URL(manifestUrl.href);
  url.searchParams.set('at',String(Date.now()));
  const response=await fetch(url.href,{cache:'no-store'});
  if(!response.ok)return;
  const data=await response.json();
  const releases=data?.releases;
  if(data?.schema!==1||!Array.isArray(releases)||!releases.length
   ||!releases.every(r=>r&&/^[a-f0-9]{40}$/.test(r.revision)&&/^\d+\.\d+\.\d+$/.test(r.version)))return;
  const latest=releases[releases.length-1];
  if(latest.revision!==revision&&newerVersion(latest.version,version))reveal();
 }catch(error){console.warn('MYON DEV update detection unavailable',error)}
 finally{checking=false}
}
// Check periodically without replacing scripts, frames, or changing the current save epoch.
window.setTimeout(check,1200);
window.setInterval(check,60000);
})();
