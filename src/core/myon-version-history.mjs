// Version history for the portal: latest DEV down to the exact approved LIVE revision.
import {validReleases} from './myon-release-state.mjs'
export function visibleVersionHistory(releases,{live,test=null,dev=null}={}){
 if(!validReleases(releases)||!live?.revision)return []
 const liveIndex=releases.findIndex(v=>v.revision===live.revision)
 if(liveIndex<0)return [] // Never guess where the approved LIVE history ends.
 const result=[]
 const placements={LIVE:live,TEST:test,DEV:dev}
 for(const release of releases.slice(liveIndex).reverse()){
  let row=result[result.length-1]
  if(!row||row.version!==release.version){
   row={version:release.version,title:release.title||'버전 업데이트',
    entries:Array.isArray(release.entries)?release.entries.filter(x=>typeof x==='string'):[],
    revisions:[],commits:[],servers:[]}
   result.push(row)
  }
  row.revisions.push(release.revision)
  const subject=release.subject||''
  if(subject&&!row.commits.includes(subject))row.commits.push(subject)
  for(const [server,pin] of Object.entries(placements)){
   if(pin?.revision===release.revision&&!row.servers.includes(server))row.servers.push(server)
  }
 }
 return result
}
