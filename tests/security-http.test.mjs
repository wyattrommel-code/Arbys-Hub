import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { createSessionToken } from "../lib/session.js";
import { SESSION_COOKIE } from "../lib/constants.js";
import { KIOSK_COOKIE_NAME } from "./test-fixtures.mjs";

// Real Next routes against a synthetic HTTP backend. Never uses production env.
test("HTTP authorization prevents direct, stale-session, kiosk and CSRF bypasses", { timeout: 180000 }, async (t) => {
  const ids = { crew: "11111111-1111-4111-8111-111111111111", gm: "22222222-2222-4222-8222-222222222222", inactive: "33333333-3333-4333-8333-333333333333" };
  const calls = [];
  const approvals = [];
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
    const idFilter = url.searchParams.get("id");
    const id = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
    let data = [];
    if (url.pathname === "/rest/v1/employees" && id) data = { id, first_name: "Synthetic", last_name: "User", is_active: id !== ids.inactive, status: "active", store_id: "07462", role: id === ids.gm ? "gm" : "crew" };
    else if (url.pathname === "/rest/v1/employee_roles") data = [{ role_id: "r", employee_id: url.searchParams.get("employee_id")?.replace("eq.", ""), roles: { id: "r", name: "Test", access_tier: url.searchParams.get("employee_id") === `eq.${ids.gm}` ? "gm" : "crew", is_active: true } }];
    else if (url.pathname === "/rest/v1/schedule_weeks") data = [{ week_start_date: "2026-09-06" }];
    else if (url.pathname === "/rest/v1/time_punches") data = [punch];
    else if (url.pathname === "/rest/v1/timecard_approvals") data = approvals;
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
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${backend.address().port}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-public-key", SUPABASE_SERVICE_ROLE_KEY: "fake-service-key", SESSION_SECRET: secret, VERCEL: "" },
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
  const range = "?from=2026-09-06&to=2026-09-12";
  const approvePath = `/api/timecards/${punch.id}/approve`;
  assert.equal((await request(approvePath, crew, "POST", { note: "Forged approval" })).status, 403);
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
});
