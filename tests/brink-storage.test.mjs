import test from "node:test";
import assert from "node:assert/strict";
import { storageSession, storageDiagnostic } from "../lib/brink-storage.js";

function query(result) {
  return { retry(enabled) { assert.equal(enabled, false); return this; },
    abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return Promise.resolve(result); } };
}
const quiet = { report() {}, sleep: async () => {} };
test("temporary database failures rebuild requests and preserve safe recovery evidence", async () => {
  const session = storageSession(quiet);
  let attempts = 0;
  const result = await session.run("save-snapshot", () => query(++attempts < 3
    ? { error: { message: "TypeError: fetch failed secret-key" }, status: 0 }
    : { data: true, error: null, status: 200 }));
  assert.equal(result.data, true);
  assert.equal(attempts, 3);
  assert.equal(session.diagnostics.length, 2);
  assert.ok(!JSON.stringify(session.diagnostics).includes("secret-key"));
});
test("persistent failures stop after three attempts and never report success", async () => {
  let attempts = 0;
  await assert.rejects(storageSession(quiet).run("read-state", () => {
    attempts++; return query({ error: { code: "PGRST002", message: "private database detail" }, status: 503 });
  }), /read-state failed \(PGRST002; HTTP 503\)/);
  assert.equal(attempts, 3);
});
test("permission and schema errors are not retried or leaked", async () => {
  for (const code of ["42501", "42P01", "PGRST204"]) {
    let attempts = 0;
    await assert.rejects(storageSession(quiet).run("log-intent", () => {
      attempts++; return query({ error: { code, message: "private row value" }, status: 403 });
    }), e => e.message.includes(code) && !e.message.includes("private"));
    assert.equal(attempts, 1);
  }
});
test("deadline prevents another request and bounded recovery stops near deadline", async () => {
  let attempts = 0;
  await assert.rejects(storageSession({ ...quiet, deadline: 100, now: () => 100 }).run("read-state", () => { attempts++; }), /deadline/);
  assert.equal(attempts, 0);
  await assert.rejects(storageSession({ ...quiet, deadline: 1000, now: () => 100 }).run("read-state", () => {
    attempts++; return query({ error: { message: "fetch failed" }, status: 0 });
  }));
  assert.equal(attempts, 1);
});
test("thrown transport errors retry; diagnostics discard arbitrary error codes", async () => {
  let attempts = 0;
  const session = storageSession(quiet);
  await session.run("save-snapshot", () => {
    if (++attempts === 1) throw new TypeError("fetch failed");
    return query({ data: true });
  });
  assert.equal(attempts, 2);
  assert.equal(storageDiagnostic({ error: { code: "secret https://private", details: "private payload" } }, "read-state").code, null);
});
