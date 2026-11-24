// DEV sunset uses a universal UTC deadline and the hosting server's HTTP Date.
// The visitor's wall clock is never used for the countdown.
export const DEV_SUNSET_UTC='2026-12-01T21:00:00.000Z'
export const DEV_SUNSET_MS=Date.parse(DEV_SUNSET_UTC)
export function validDevSunset(data){
 return !!(data&&data.schema===1&&data.timezone==='Asia/Seoul'&&
  Number.isSafeInteger(data.endsAt)&&data.endsAt===DEV_SUNSET_MS)
}
export function parseServerDate(value){
 if(typeof value!=='string'||!value||!/(?:GMT|UTC)$/i.test(value.trim()))
  throw Error('서버의 표준시 응답을 확인할 수 없습니다.')
 const ms=Date.parse(value)
 if(!Number.isSafeInteger(ms)||ms<=0)
  throw Error('서버의 표준시 응답이 올바르지 않습니다.')
 return ms
}
export function syncedNow(serverEpoch,atMonotonic,nowMonotonic){
 if(!Number.isFinite(serverEpoch)||!Number.isFinite(atMonotonic)||!Number.isFinite(nowMonotonic))
  throw Error('표준시 동기화 상태가 올바르지 않습니다.')
 return serverEpoch+Math.max(0,nowMonotonic-atMonotonic)
}
export function remainingDevMs(deadline,now){
 return Math.max(0,deadline-now)
}
export function formatDevCountdown(remaining){
 const s=Math.ceil(Math.max(0,remaining)/1000)
 const two=n=>String(n).padStart(2,'0')
 return Math.floor(s/86400)+'일 '+two(Math.floor(s%86400/3600))+':'+
  two(Math.floor(s%3600/60))+':'+two(s%60)
}
