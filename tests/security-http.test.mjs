import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { createSessionToken } from "../lib/session.js";
import { SESSION_COOKIE } from "../lib/constants.js";
import { KIOSK_COOKIE_NAME } from "./test-fixtures.mjs";

// Real Next routes against a synthetic HTTP backend. Never uses production env.
test("HTTP authorization prevents direct, stale-session, kiosk and CSRF bypasses", { timeout: 300000 }, async (t) => {
  const ids = { crew: "11111111-1111-4111-8111-111111111111", gm: "22222222-2222-4222-8222-222222222222", inactive: "33333333-3333-4333-8333-333333333333" };
  const calls = [];
  let station = null;
  let managerActive = true;
  let storageFailure = false;
  const rateKeys = [];
  const gatewaySecret = 'synthetic-clock-gateway-secret-at-least-32-characters';
  const approvals = [];
  let breakRows = [];
  const editCalls = [];
  let editFailure = null;
  const punch = { id: "44444444-4444-4444-8444-444444444444", employee_id: ids.crew, employee_name: "Synthetic Crew", store_id: "payson", clock_in: "2026-09-09T16:00:00Z", clock_out: "2026-09-09T22:00:00Z", worked_minutes: 360, unscheduled: true };

  const backend = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    calls.push({ path: url.pathname, query: url.searchParams, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/rest/v1/roast_entries" && req.method === "POST") {
      res.statusCode = 201;
      res.end();
      return;
    }
    if (url.pathname === "/rest/v1/timecard_approvals" && req.method === "POST") {
      let body = ""; for await (const part of req) body += part;
      approvals.push({ ...JSON.parse(body), approved_at: new Date().toISOString() });
      res.statusCode = 201; res.end(); return;
    }
    if (url.pathname === "/rest/v1/clock_kiosk_stations") {
      if (req.method === "POST") {
        let body = ""; for await (const part of req) body += part;
        station = { ...station, ...JSON.parse(body) }; res.statusCode=201; res.end(); return;
      }
      const matching = station && ['device_hash','pairing_hash'].every(field => !url.searchParams.has(field) || url.searchParams.get(field) === `eq.${station[field]}`)
        && ['device_expires_at','pairing_expires_at'].every(field => !url.searchParams.has(field) || new Date(station[field]) > new Date());
      res.end(JSON.stringify(matching ? [station] : [])); return;
    }
    if (url.pathname === '/rest/v1/rpc/hub_consume_pin_attempt') {
      let body = ''; for await (const part of req) body += part;
      rateKeys.push(JSON.parse(body).p_client_key); res.end('true'); return;
    }
    if (url.pathname === '/rest/v1/rpc/hub_employee_by_pin') {
      let body = ''; for await (const part of req) body += part;
      res.end(JSON.stringify(JSON.parse(body).p_pin === '5678' ? ids.gm : null)); return;
    }
    if (url.pathname === '/rest/v1/rpc/hub_pair_clock_station') {
      let body = ''; for await (const part of req) body += part;
      const params = JSON.parse(body);
      const valid = station && station.pairing_hash === params.p_pairing_hash && station.pairing_by === params.p_issuer && new Date(station.pairing_expires_at) > new Date();
      if (valid) station = { ...station, device_hash: params.p_device_hash, paired_at: new Date().toISOString(), device_expires_at: new Date(Date.now()+86400000).toISOString(), pairing_hash:null, pairing_expires_at:null };
      res.end(JSON.stringify(!!valid)); return;
    }
    if (url.pathname.startsWith('/storage/v1/object/punch-photos/') && req.method === 'POST') {
      let bytes=0; for await (const part of req) bytes+=part.length;
      assert.ok(bytes>0);
      if (storageFailure) { res.statusCode=500; res.end(JSON.stringify({message:'Synthetic upload failure'})); }
      else res.end(JSON.stringify({Key:url.pathname.split('/object/')[1]}));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/hub_correct_missed_punch_photo') {
      let body = ''; for await (const part of req) body += part;
      const params = JSON.parse(body);
      assert.equal(params.p_employee, ids.gm);
      assert.ok(['forgot_clock_in','forgot_clock_out','forgot_break_start','forgot_break_end'].includes(params.p_type));
      assert.ok(params.p_photo_url.includes(`/punch-photos/payson/${ids.gm}/`));
      assert.equal(params.p_face_detected,true);
      assert.equal(params.p_claimed, '2026-09-29T15:00:00.000Z');
      res.end(JSON.stringify({punch:{...punch,clock_out:params.p_type === 'forgot_clock_out' ? new Date().toISOString() : null,on_break:params.p_type === 'forgot_break_start'}})); return;
    }
    if (url.pathname === '/rest/v1/rpc/hub_edit_timecard') {
      let body = ''; for await (const part of req) body += part;
      const params = JSON.parse(body); editCalls.push(params);
      if (editFailure) { res.statusCode=400; res.end(JSON.stringify(editFailure)); return; }
      assert.equal(params.p_actor,ids.gm); assert.equal(params.p_actor_name,'Synthetic User');
      breakRows=params.p_breaks.map((b,index)=>({id:b.id || `66666666-6666-4666-8666-${String(index).padStart(12,'0')}`,time_punch_id:punch.id,break_start:b.start,break_end:b.end,break_minutes:Math.round((Date.parse(b.end)-Date.parse(b.start))/60000),status:'edited'}));
      Object.assign(punch,{clock_in:params.p_clock_in,clock_out:params.p_clock_out,status:'edited',edit_revision:(punch.edit_revision||0)+1,total_break_minutes:breakRows.reduce((n,b)=>n+b.break_minutes,0)});
      punch.worked_minutes=Math.round((Date.parse(punch.clock_out)-Date.parse(punch.clock_in))/60000)-punch.total_break_minutes;
      res.end(JSON.stringify(punch));return;
    }
    const idFilter = url.searchParams.get("id");
    const id = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
    let data = [];
    if (url.pathname === "/rest/v1/employees" && id) data = { id, first_name: "Synthetic", last_name: "User", is_active: id !== ids.inactive && (id !== ids.gm || managerActive), status: "active", store_id: "07462", role: id === ids.gm ? "gm" : "crew" };
    else if (url.pathname === "/rest/v1/employee_roles") data = [{ role_id: "r", employee_id: url.searchParams.get("employee_id")?.replace("eq.", ""), roles: { id: "r", name: "Test", access_tier: url.searchParams.get("employee_id") === `eq.${ids.gm}` ? "gm" : "crew", is_active: true } }];
    else if (url.pathname === "/rest/v1/schedule_weeks") data = [{ week_start_date: "2026-09-06" }];
    else if (url.pathname === "/rest/v1/time_punches") data = [punch];
    else if (url.pathname === "/rest/v1/timecard_approvals") data = approvals;
    else if (url.pathname === "/rest/v1/break_punches") data = breakRows;
    res.end(JSON.stringify(data));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const portFinder = http.createServer();
  await new Promise((resolve) => portFinder.listen(0, "127.0.0.1", resolve));
  const port = portFinder.address().port;
  await new Promise((resolve) => portFinder.close(resolve));
  const origin = `http://localhost:${port}`;
  const secret = "http-test-only-secret-not-production";
  process.env.SESSION_SECRET = secret;
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "localhost", "--port", String(port)], {
    cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${backend.address().port}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-public-key", SUPABASE_SERVICE_ROLE_KEY: "fake-service-key", SESSION_SECRET: secret, VERCEL: "", CLOCK_ONLY: "false", CLOCK_GATEWAY_SECRET: gatewaySecret },
  });
  let log = "";
  app.stdout.on("data", (d) => { log += d; }); app.stderr.on("data", (d) => { log += d; });
  t.after(async () => {
    backend.closeAllConnections();
    if (process.platform === "win32") await new Promise((resolve) => execFile("taskkill", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true }, resolve));
    else app.kill("SIGTERM");
    app.stdout.destroy(); app.stderr.destroy(); app.unref();
    await new Promise((resolve) => backend.close(resolve));
  });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${origin}/api/auth/me`); if (r.status === 401) { ready = true; break; } } catch { /* starting */ }
    if (app.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, log.slice(-4000));
  const token = (id, role, purpose) => createSessionToken({ employee_id: id, first_name: "Synthetic", last_name: "User", role }, purpose);
  const cookie = async (id, role = "gm") => `${SESSION_COOKIE}=${await token(id, role)}`;
  const request = (path, cookieValue, method = "GET", body, requestOrigin = origin) => fetch(origin + path, { method, headers: { ...(cookieValue ? { Cookie: cookieValue } : {}), Origin: requestOrigin, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const crew = await cookie(ids.crew); // Deliberately stale GM claim must become crew.
  const gm = await cookie(ids.gm);
  assert.equal((await request("/api/integrations/brink")).status, 401);
  assert.equal((await request("/api/integrations/brink", crew)).status, 403);
  assert.equal((await request("/api/integrations/brink", crew, "POST", { date: "2026-09-09" })).status, 403);
  assert.equal((await request("/api/cron/brink-sales", gm)).status, 401);
  for (const path of ["/api/integrations/brink/logs?date=2026-09-09", "/api/integrations/brink/logs?date=2026-09-09&export=1"]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, crew)).status, 403);
  }
  assert.equal((await request("/api/integrations/brink/automation", crew, "POST", {enabled:true})).status, 403);
  assert.equal((await request("/api/integrations/brink/logs?date=bad", gm)).status, 400);
  const range = "?from=2026-09-06&to=2026-09-12";
  const approvePath = `/api/timecards/${punch.id}/approve`;
  const forged = await request(approvePath, crew, "POST", { note: "Forged approval" });
  assert.equal(forged.status, 403, (await forged.text()).slice(0,500) + log.slice(-5000));
  assert.equal((await request("/api/data/timecard_approvals", gm, "POST", {})).status, 403);
  let cards = await (await request("/api/timecards" + range, gm)).json();
  assert.equal(cards.pending_count, 1, JSON.stringify(cards));
  assert.equal((await request("/api/timecards/export" + range, gm)).status, 409);
  const version = cards.groups[0].punches[0].review_version;
  assert.equal((await request(approvePath, gm, "POST", { version: "stale", note: "Reviewed" })).status, 409);
  assert.equal((await request(approvePath, gm, "POST", { version, note: "" })).status, 400);
  assert.equal((await request(approvePath, gm, "POST", { version, note: "Verified worked hours" })).status, 200);
  assert.equal(approvals[0].approved_by, ids.gm);
  assert.equal(approvals[0].reviewed_snapshot.minutes, 360);
  assert.equal((await request("/api/timecards/export" + range, gm)).status, 200);
  const editPath=`/api/timecards/${punch.id}`;
  const originalPunch={...punch};
  let editInput={clock_in:'2026-09-09T10:00',clock_out:'2026-09-09T16:00',breaks:[{start:'2026-09-09T12:00',end:'2026-09-09T12:30'}],note:'Correct missed break',version:cards.groups[0].punches[0].edit_version};
  assert.equal((await request(editPath,undefined,'PATCH',editInput)).status,401);
  assert.equal((await request(editPath,crew,'PATCH',editInput)).status,403);
  assert.equal((await request(editPath,gm,'PATCH',editInput,'https://attacker.invalid')).status,403);
  assert.equal((await request(editPath,gm,'PATCH',{...editInput,note:''})).status,400);
  assert.equal((await request(editPath,gm,'PATCH',{...editInput,version:'b'.repeat(64)})).status,409);
  assert.equal(editCalls.length,0);
  const addedResponse=await request(editPath,gm,'PATCH',editInput);
  assert.equal(addedResponse.status,200,await addedResponse.text());
  assert.equal(editCalls[0].p_expected.breaks.length,0);
  assert.equal(punch.worked_minutes,330);
  assert.equal((await request('/api/timecards/export'+range,gm)).status,409);
  assert.equal((await request(editPath,gm,'PATCH',editInput)).status,409);
  cards=await (await request('/api/timecards'+range,gm)).json();
  editInput={...editInput,version:cards.groups[0].punches[0].edit_version,breaks:[{id:breakRows[0].id,start:'2026-09-09T12:00',end:'2026-09-09T12:45'}]};
  assert.equal((await request(editPath,gm,'PATCH',editInput)).status,200);assert.equal(punch.worked_minutes,315);
  cards=await (await request('/api/timecards'+range,gm)).json();
  editInput={...editInput,version:cards.groups[0].punches[0].edit_version,breaks:[]};
  editFailure={code:'40001',message:'This punch changed.'};
  assert.equal((await request(editPath,gm,'PATCH',editInput)).status,409);assert.equal(breakRows.length,1);
  editFailure=null;
  assert.equal((await request(editPath,gm,'PATCH',editInput)).status,200);assert.equal(punch.worked_minutes,360);assert.equal(breakRows.length,0);
  for (const key of Object.keys(punch)) delete punch[key];Object.assign(punch,originalPunch);
  punch.clock_out = "2026-09-09T22:30:00Z";
  assert.equal((await request("/api/timecards/export" + range, gm)).status, 409);
  punch.clock_out = null;
  cards = await (await request("/api/timecards" + range, gm)).json();
  assert.equal((await request(approvePath, gm, "POST", { version: cards.groups[0].punches[0].review_version, note: "Open punch" })).status, 409);
  const savedRoast = await request("/api/data/roast_entries?on_conflict=sheet_date,daypart", crew, "POST", { sheet_date: "2026-09-08", daypart: "6am", on_hand: 4 });
  const savedRoastBody = await savedRoast.text();
  assert.equal(savedRoast.status, 201, savedRoastBody);
  assert.equal(savedRoastBody, "");
  assert.equal(savedRoast.headers.get("cache-control"), "private, no-store");
  assert.equal((await request("/api/data/employees")).status, 401);
  assert.equal((await request("/api/data/employee_wages", crew)).status, 403);
  assert.equal((await request("/api/data/employees?select=employee_code", gm)).status, 403);
  assert.equal((await request("/api/data/employees", await cookie(ids.inactive))).status, 401);
  assert.equal((await request("/api/data/roles", crew, "POST", { name: "Fake", access_tier: "gm" })).status, 403);
  assert.equal((await request("/api/data/roast_entries", crew, "POST", { sheet_date: "2026-09-08", daypart: "6am", on_hand: 4 }, "https://attacker.invalid")).status, 403);
  const roster = await request("/api/data/employees", crew);
  assert.equal(roster.status, 200);
  assert.equal(roster.headers.get("cache-control"), "private, no-store");
  const rosterCall = calls.findLast((c) => c.path === "/rest/v1/employees" && !c.query.has("id"));
  assert.ok(!rosterCall.query.get("select").includes("employee_code"));
  assert.ok(!rosterCall.query.get("select").includes("email"));
  assert.equal(rosterCall.authorization, "Bearer fake-service-key");
  assert.equal((await request("/api/data/schedule_shifts?employee_id=eq.other", crew)).status, 200);
  const shifts = calls.findLast((c) => c.path === "/rest/v1/schedule_shifts");
  assert.deepEqual(shifts.query.getAll("employee_id"), ["eq.other", `eq.${ids.crew}`]);
  assert.equal(shifts.query.get("week_start_date"), "in.(2026-09-06)");
  assert.equal((await request("/api/clock/roster")).status, 401);
  assert.equal((await request("/api/clock/roster", gm)).status, 401);
  const kiosk = `${KIOSK_COOKIE_NAME}=${await token(ids.gm, "gm", "kiosk")}`;
  assert.equal((await request("/api/data/employee_wages", kiosk)).status, 401);
  assert.equal((await request("/api/photos/punch-photos/payson/other/photo.jpg", crew)).status, 403);

  assert.equal((await request("/api/photos/profile-photos/payson/employee.jpg")).status, 401);
  // A manager PIN or old kiosk cookie alone no longer authorizes a personal device.
  assert.equal((await request('/api/clock/unlock', gm, 'POST', {pin:'5678'})).status,403);
  assert.equal((await request('/api/clock/roster', kiosk)).status,401);
  assert.equal((await request('/api/settings/clock-station', crew, 'POST', {action:'issue'})).status,403);
  const stationPath = '/api/settings/clock-station';
  assert.equal((await request(stationPath, gm, 'POST', {action:'issue'}, 'https://attacker.invalid')).status,403);

  const findClockPort = http.createServer();
  await new Promise(resolve => findClockPort.listen(0,'127.0.0.1',resolve));
  const clockPort = findClockPort.address().port;
  await new Promise(resolve=>findClockPort.close(resolve));
  const clockOrigin = `http://localhost:${clockPort}`;
  const clockApp = spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','localhost','--port',String(clockPort)],{
    cwd:process.cwd(), windowsHide:true, stdio:['ignore','pipe','pipe'],
    env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',CLOCK_ONLY:'true',HUB_BACKEND_URL:origin,CLOCK_GATEWAY_SECRET:gatewaySecret,
      SESSION_SECRET:'',NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',VERCEL:''},
  });
  let clockLog=''; clockApp.stdout.on('data',d=>{clockLog+=d;});clockApp.stderr.on('data',d=>{clockLog+=d;});
  t.after(async()=>{
    if(process.platform==='win32') await new Promise(resolve=>execFile('taskkill',['/PID',String(clockApp.pid),'/T','/F'],{windowsHide:true},resolve));
    else clockApp.kill('SIGTERM');
    clockApp.stdout.destroy(); clockApp.stderr.destroy(); clockApp.unref();
  });
  const clockRequest = (path,cookieValue='',method='GET',body,originValue=clockOrigin)=>fetch(clockOrigin+path,{
    method,redirect:'manual',headers:{Cookie:cookieValue,Origin:originValue,...(body instanceof FormData ? {} : {'Content-Type':'application/json'})},body:body instanceof FormData ? body : body?JSON.stringify(body):undefined,
  });
  let clockReady=false;
  for(let i=0;i<120;i++){
    try{if((await clockRequest('/api/clock/status')).status===200){clockReady=true;break;}}catch{/*starting*/}
    if(clockApp.exitCode!=null)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(clockReady,clockLog.slice(-4000));
  for(const path of ['/api/data/employees','/api/settings/clock-station','/api/auth/me','/api/station/api/clock/status','/people','/timeclock/timecards','/api/photos/punch-photos/payson/a.jpg']) assert.equal((await clockRequest(path,gm)).status,404,path);
  assert.deepEqual(await (await clockRequest('/api/clock/status',gm)).json(),{paired:false,unlocked:false});
  assert.equal((await clockRequest('/api/clock/unlock',gm,'POST',{pin:'5678'})).status,403);
  for (const path of ['/api/clock/corrections','/api/clock/in','/api/clock/out','/api/clock/identify','/api/clock/break/start','/api/clock/break/end']) assert.equal((await clockRequest(path,gm,'POST',{pin:'5678'})).status,401,path);
  assert.equal((await clockRequest('/api/clock/unlock','','POST',{pin:'5678'},'https://attacker.invalid')).status,403);
  const issue = async()=>(await (await request(stationPath,gm,'POST',{action:'issue'})).json()).code;
  const pairingCode=await issue(); assert.ok(pairingCode);
  const pairResult=await clockRequest('/api/clock/device/pair','','POST',{code:pairingCode});
  assert.equal(pairResult.status,200,await pairResult.clone().text());
  assert.match(pairResult.headers.get('cache-control'),/no-store/);
  const deviceCookie=pairResult.headers.getSetCookie().find(c=>c.startsWith('hub_clock_device=')).split(';')[0];
  assert.match(pairResult.headers.getSetCookie().find(c=>c.startsWith('hub_clock_device=')),/HttpOnly/i);
  assert.equal((await clockRequest('/api/clock/device/pair','','POST',{code:pairingCode})).status,403);
  assert.deepEqual(await (await clockRequest('/api/clock/status',deviceCookie)).json(),{paired:true,unlocked:false});
  assert.equal((await clockRequest('/api/clock/roster',deviceCookie)).status,401);
  const unlock=await clockRequest('/api/clock/unlock',deviceCookie,'POST',{pin:'5678'});
  assert.equal(unlock.status,200,await unlock.clone().text());
  const shiftCookie=unlock.headers.getSetCookie().find(c=>c.startsWith('hub_kiosk=')).split(';')[0];
  const authorized=deviceCookie+'; '+shiftCookie;
  assert.equal(new Set(rateKeys).size,2); // pairing attempts cannot consume the employee-PIN budget
  assert.deepEqual(await (await clockRequest('/api/clock/status',authorized)).json(),{paired:true,unlocked:true});
  assert.equal((await clockRequest('/api/clock/roster',authorized)).status,200);

  const missed = {employee_id:ids.gm,pin:'0000',type:'forgot_clock_in',claimed_time:'2026-09-29T09:00',reason:'Missed while busy',punch_id:'',break_id:''};
  const jpeg = new Blob([new Uint8Array([255,216,255,0,255,217])],{type:'image/jpeg'});
  const correctionForm = (body,photo=jpeg) => {
    const form=new FormData(); Object.entries({...body,face_detected:'true'}).forEach(([key,value])=>form.set(key,value));
    if (photo) form.set('file',photo,'capture.jpg'); return form;
  };
  assert.equal((await clockRequest('/api/clock/corrections',authorized,'POST',correctionForm(missed))).status,401);
  assert.equal((await clockRequest('/api/clock/corrections',authorized,'POST',correctionForm({...missed,pin:'5678',employee_id:ids.crew}))).status,401);
  assert.equal((await clockRequest('/api/clock/corrections',authorized,'POST',correctionForm({...missed,pin:'5678'}),'https://attacker.invalid')).status,403);
  assert.equal((await request('/api/clock/corrections',authorized,'POST',{...missed,pin:'5678'})).status,401);
  assert.equal((await clockRequest('/api/clock/corrections',authorized,'POST',correctionForm({...missed,type:'delete_punch'}))).status,400);
  assert.equal((await clockRequest('/api/clock/corrections',authorized,'POST',{...missed,pin:'5678'})).status,400);
  for (const type of ['forgot_clock_in','forgot_clock_out','forgot_break_start','forgot_break_end']) {
    const body={...missed,type,pin:'5678'};
    const before=calls.filter(c=>c.path.includes('hub_correct_missed_punch_photo')).length;
    for (const invalid of [null,new Blob([],{type:'image/jpeg'}),new Blob(['not a photo'],{type:'image/jpeg'})]) {
      assert.equal((await clockRequest('/api/clock/corrections',authorized,'POST',correctionForm(body,invalid))).status,400);
    }
    assert.equal(calls.filter(c=>c.path.includes('hub_correct_missed_punch_photo')).length,before);
    const saved=await clockRequest('/api/clock/corrections',authorized,'POST',correctionForm(body));
    assert.equal(saved.status,200,await saved.clone().text());
    assert.deepEqual(await saved.json(),{ok:true,action:type,clocked_in:type!=='forgot_clock_out',on_break:type==='forgot_break_start'});
    assert.match(saved.headers.get('cache-control'),/no-store/);
  }
  storageFailure=true;
  const rpcCount=calls.filter(c=>c.path.includes('hub_correct_missed_punch_photo')).length;
  assert.equal((await clockRequest('/api/clock/corrections',authorized,'POST',correctionForm({...missed,pin:'5678'}))).status,500);
  assert.equal(calls.filter(c=>c.path.includes('hub_correct_missed_punch_photo')).length,rpcCount);
  assert.equal(calls.some(c=>c.path==='/storage/v1/bucket'),false);
  storageFailure=false;
  managerActive=false;
  assert.deepEqual(await (await clockRequest('/api/clock/status',authorized)).json(),{paired:true,unlocked:false});
  assert.equal((await clockRequest('/api/clock/roster',authorized)).status,401);
  managerActive=true;
  assert.equal((await request('/api/clock/roster',authorized)).status,401); // bypassing the gateway fails
  assert.equal((await clockRequest('/api/clock/roster',shiftCookie)).status,401);
  const replacement=await issue();
  assert.equal((await clockRequest('/api/clock/roster',authorized)).status,200); // issuing alone preserves old iPad
  assert.equal((await clockRequest('/api/clock/device/pair','','POST',{code:replacement})).status,200);
  assert.equal((await clockRequest('/api/clock/roster',authorized)).status,401); // replaced device rejected
  const pending=await issue();
  assert.equal((await request(stationPath,gm,'POST',{action:'revoke'})).status,200);
  assert.equal((await clockRequest('/api/clock/device/pair','','POST',{code:pending})).status,403);
  assert.deepEqual(await (await clockRequest('/api/clock/status',authorized)).json(),{paired:false,unlocked:false});

});
