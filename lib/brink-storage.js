import { BrinkError } from "./brink";

// Never persist arbitrary upstream text: database errors can include row values,
// URLs or credentials. Keep actionable codes, HTTP status and a known step name.
export function storageDiagnostic(result, stage) {
  const error = result?.error || result || {};
  const code = /^(?:[0-9A-Z]{5}|PGRST\d{3}|ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT)$/.test(error.code || "") ? error.code : null;
  const text = `${error.name || ""} ${error.message || ""} ${error.details || ""}`;
  const kind = /timeout|timed out|abort/i.test(text) ? "timeout" : /fetch failed|network|socket|connection/i.test(text) ? "connection" : "database";
  const status = Number.isInteger(result?.status) ? result.status : 0;
  return { stage, code, status, kind };
}

export function transientStorage(d) {
  return d.kind === "timeout" || d.kind === "connection" || [408,429,502,503,504].includes(d.status) ||
    ["40001","40P01","53300","57014","57P01","PGRST000","PGRST001","PGRST002","PGRST003"].includes(d.code);
}

export function storageSession({ deadline = Date.now() + 45000, diagnostics = [], now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), report = (d) => console.warn("brink_storage", d) } = {}) {
  async function run(stage, build, { retry = true } = {}) {
    for (let attempt = 1; attempt <= (retry ? 3 : 1); attempt++) {
      const remaining = deadline - now();
      if (remaining < 100) throw new BrinkError(`Sync deadline reached during ${stage}. Previous data is retained.`, 503);
      let result;
      try {
        // Disable the SDK's independent retry loop so the total runtime is bounded.
        result = await build().retry(false).abortSignal(AbortSignal.timeout(Math.min(6000, Math.floor(remaining))));
      } catch (error) { result = { error, status: 0 }; }
      if (!result.error) return result;
      const d = { ...storageDiagnostic(result, stage), attempt };
      diagnostics.push(d); report(d);
      if (!retry || !transientStorage(d) || attempt === 3 || deadline - now() < 1100) {
        throw new BrinkError(`Database step ${stage} failed (${d.code || d.kind}; HTTP ${d.status || "unavailable"}). Previous data is retained.`, 503);
      }
      await sleep(attempt * 250);
    }
  }
  return { run, diagnostics, deadline };
}
