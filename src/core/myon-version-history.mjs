// Portal history is limited to actual configured server revisions.
// Historical intermediate releases remain in the manifest, not in the launcher.
import {validReleases} from './myon-release-state.mjs'

export function visibleVersionHistory(releases,{live,test=null,dev=null}={}){
 if(!validReleases(releases)||!live?.revision)return []
 if(!releases.some(item=>item.revision===live.revision))return []
 const pinned=new Map()
 const servers={LIVE:live,TEST:test,DEV:dev}
 for(const [name,pin] of Object.entries(servers)){
  if(!pin?.revision)continue
  const index=releases.findIndex(item=>item.revision===pin.revision)
  if(index<0)continue // Not published / not deployed; do not claim availability.
  const release=releases[index]
  let slot=pinned.get(release.version)
  if(!slot){
   slot={index,version:release.version,title:release.title||'버전 업데이트',
    entries:Array.isArray(release.entries)?release.entries.filter(s=>typeof s==='string'):[],
    revisions:[],commits:[],servers:[]}
   pinned.set(release.version,slot)
  }
  if(index>=slot.index){
   slot.title=release.title||slot.title
   if(Array.isArray(release.entries)&&release.entries.length)
    slot.entries=release.entries.filter(s=>typeof s==='string')
   slot.index=index
  }
  if(!slot.revisions.includes(release.revision))slot.revisions.push(release.revision)
  if(release.subject&&!slot.commits.includes(release.subject))slot.commits.push(release.subject)
  if(!slot.servers.includes(name))slot.servers.push(name)
 }
 return [...pinned.values()].sort((a,b)=>b.index-a.index).map(({index,...visible})=>visible)
}
