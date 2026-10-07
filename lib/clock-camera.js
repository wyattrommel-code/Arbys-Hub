// Share a permission request and briefly reuse the camera for retakes.
// Idle tracks are disabled; leaving/backgrounding the clock releases the device immediately.
export function createClockCamera(request, schedule=setTimeout, cancel=clearTimeout) {
  let stream=null, pending=null, idle=null, generation=0;
  const users=new Set();
  function close() {
    generation++;
    cancel(idle);idle=null;
    stream?.getTracks().forEach(track=>track.stop());
    stream=null;pending=null;users.clear();
  }
  function pause() {
    if(users.size) return;
    stream?.getTracks().forEach(track=>{track.enabled=false;});
    cancel(idle);idle=schedule(close,30000);
  }
  function acquire() {
    cancel(idle);idle=null;
    if(stream?.getVideoTracks().some(track=>track.readyState==='ended')) close();
    const token={};users.add(token);
    if(!pending) {
      const started=generation;
      pending=Promise.resolve().then(request).then(value=>{
        if(started!==generation) {value.getTracks().forEach(track=>track.stop());throw new Error('Camera paused. Try again.');}
        stream=value;
        pause();
        return value;
      }).catch(error=>{if(started===generation) pending=null;throw error;});
    }
    return {ready:pending.then(value=>{
      if(users.has(token)) value.getTracks().forEach(track=>{track.enabled=true;});
      return value;
    }),release:()=>{users.delete(token);pause();}};
  }
  return {acquire,close};
}
let camera;
export function acquireClockCamera() {
  if(!camera) {
    camera=createClockCamera(async()=>{
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:'user',width:{ideal:640},height:{ideal:480},resizeMode:'none',frameRate:{ideal:15,max:24}},audio:false,
      });
      const track=stream.getVideoTracks()[0];
      const zoom=track.getCapabilities?.().zoom;
      if(zoom && Number.isFinite(zoom.min)) {
        try { await track.applyConstraints({advanced:[{zoom:zoom.min}]}); } catch { /* optional */ }
      }
      return stream;
    });
    window.addEventListener('pagehide',()=>camera.close());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')camera.close();});
  }
  return camera.acquire();
}
