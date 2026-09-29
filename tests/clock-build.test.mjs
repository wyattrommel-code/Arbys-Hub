import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';

// Requires a completed CLOCK_ONLY=true production build. Uses no real backend.
test('production clock serves its screen and denies Hub routes without Hub secrets', { timeout: 60000 }, async t => {
  const finder=http.createServer();
  await new Promise(resolve=>finder.listen(0,'127.0.0.1',resolve));
  const port=finder.address().port; await new Promise(resolve=>finder.close(resolve));
  const origin=`http://localhost:${port}`;
  const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','localhost','--port',String(port)],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:process.cwd(),
    env:{...process.env,NODE_ENV:'production',CLOCK_ONLY:'true',NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',
      SUPABASE_SERVICE_ROLE_KEY:'',SESSION_SECRET:'',CLOCK_GATEWAY_SECRET:'',HUB_BACKEND_URL:''},
  });
  let log='';app.stdout.on('data',d=>{log+=d;});app.stderr.on('data',d=>{log+=d;});
  t.after(async()=>{
    if(process.platform==='win32')await new Promise(resolve=>execFile('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true},resolve));
    else app.kill('SIGTERM');
    app.stdout.destroy();app.stderr.destroy();app.unref();
  });
  let ready=false;
  for(let i=0;i<80;i++){
    try{if((await fetch(origin+'/api/auth/me')).status===404){ready=true;break;}}catch{/*starting*/}
    if(app.exitCode!=null)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,log.slice(-4000));
  for(const path of ['/','/clock']){
    const res=await fetch(origin+path);const body=await res.text();
    assert.equal(res.status,200,body.slice(0,200) + "\n" + log.slice(-6000));assert.match(body,/Store time clock/);assert.match(body,/Connecting/);
  }
  for(const path of ['/people','/settings','/api/settings/clock-station','/api/data/employees','/api/station/api/clock/status'])assert.equal((await fetch(origin+path)).status,404,path);
  assert.equal((await fetch(origin+'/api/clock/status')).status,503); // no backend config fails closed
  assert.equal((await fetch(origin+'/api/clock/unlock',{method:'POST',headers:{Origin:'https://other.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
});
