import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveResource, checkResourceOrigin, listResources, loadResourceCategories, resourceDownload, saveResource, saveResourceCategories } from "../lib/resources-server.js";
import { filterResources, MAX_RESOURCE_FILE_BYTES, normalizeResourceTags, RESOURCE_CATEGORIES, validateResource, validateResourceCategories, validateResourceFile } from "../lib/resources.js";

const ID = "11111111-1111-4111-8111-111111111111";
const manager = { employee_id: "manager-test", role: "assistant_manager", store_id: "07462", store_verified: true };
const crew = { employee_id: "crew-test", role: "crew", store_id: "07462", store_verified: true };
const input = { title: "Slicer maintenance", category: "equipment", summary: "Weekly cleaning", notes: "Follow the approved manual.", url: "", visibility: "team", pinned: false, tags: [] };
const base = { ...input, id: ID, store_id: "07462", archived: false, version: 1, object_path: null, file_name: null, file_size: null, mime_type: null, updated_at: "2026-10-16T12:00:00Z" };

function database(seed = [base], options = {}) {
  const state = { rows: structuredClone(seed), categories: structuredClone(options.categories || RESOURCE_CATEGORIES), categoriesVersion: 1, uploads: [], removals: [], signatures: [], queries: [], rpcCalls: [] };
  class Query {
    constructor() { this.filters = []; this.kind = "select"; this.payload = null; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    order() { return this; }
    insert(payload) { this.kind = "insert"; this.payload = payload; return this; }
    update(payload) { this.kind = "update"; this.payload = payload; return this; }
    maybeSingle() { return this.run(true); }
    then(resolve, reject) { return this.run(false).then(resolve, reject); }
    async run(single) {
      state.queries.push({ kind: this.kind, filters: this.filters });
      if (this.kind !== "select" && options.failWrite) return { data: null, error: new Error("Write failed") };
      if (this.kind === "update" && options.race) return { data: null, error: null };
      let rows = state.rows.filter((row) => this.filters.every(([key, value]) => row[key] === value));
      if (this.kind === "insert") {
        rows = [{ ...base, ...this.payload }]; state.rows.push(...rows);
      } else if (this.kind === "update") rows.forEach((row) => Object.assign(row, this.payload));
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    }
  }
  return { state, from: () => new Query(), rpc: async (name, args) => {
    state.rpcCalls.push({ name, args });
    if (name === "save_hub_resource_tabs") {
      if (options.raceTabs) return { error: { message: "resource_tabs_conflict" }, data: null };
      state.categories = structuredClone(args.p_tabs); state.categoriesVersion++;
    }
    return { data: { categories: structuredClone(state.categories), version: state.categoriesVersion }, error: null };
  }, storage: { from: () => ({
    upload: async (path, bytes, opts) => { state.uploads.push({ path, bytes, opts }); return { error: options.failUpload ? new Error("Upload failed") : null }; },
    remove: async (paths) => { state.removals.push(...paths); return { error: null }; },
    createSignedUrl: async (...args) => { state.signatures.push(args); return { data: { signedUrl: "https://storage.example/signed-file" }, error: null }; },
  }) } };
}

const file = () => new File(["approved guide"], "guide.pdf", { type: "application/pdf" });
test("validates categories, titles, and safe links", () => {
  assert.equal(validateResource({ ...input, title: " Guide " }).title, "Guide");
  for (const url of ["javascript:alert(1)", "data:text/html,test", "https://user:password@example.com", "not a link"]) assert.throws(() => validateResource({ ...input, url }));
  assert.throws(() => validateResource({ ...input, title: " " }));
  assert.throws(() => validateResource({ ...input, category: "unknown" }));
  assert.throws(() => validateResource({ ...input, visibility: "public" }));
  assert.throws(() => validateResource({ ...input, pinned: "false" }));
});
test("rejects empty, unsupported, and oversized attachments", () => {
  assert.throws(() => validateResourceFile(new File([], "empty.pdf")), /empty/);
  assert.throws(() => validateResourceFile(new File(["html"], "page.html")), /Use a PDF/);
  assert.throws(() => validateResourceFile({ name: "large.pdf", size: MAX_RESOURCE_FILE_BYTES + 1, arrayBuffer() {} }), /4 MB/);
  assert.equal(validateResourceFile(file()).type, "application/pdf");
});
test("searches across category, notes, and filenames with every term required", () => {
  const rows = [{ ...base, notes: "Weekly slicer service", file_name: "slicer.pdf" }];
  assert.equal(filterResources(rows, { search: "equipment weekly pdf" }).length, 1);
  assert.equal(filterResources(rows, { search: "weekly nonexistent" }).length, 0);
  assert.equal(filterResources(rows, { category: "training" }).length, 0);
});
test("pins sort first and alphabetical sorting is available", () => {
  const rows = [{ ...base, title: "Zebra", pinned: true }, { ...base, title: "Beta" }, { ...base, title: "Alpha" }];
  assert.deepEqual(filterResources(rows, { sort: "title" }).map((row) => row.title), ["Zebra", "Alpha", "Beta"]);
  assert.equal(filterResources(rows, { pinnedOnly: true }).length, 1);
});
test("requires login and manager access for mutations", async () => {
  await assert.rejects(listResources(database(), null), { status: 401 });
  for (const role of ["crew", "shift_lead"]) await assert.rejects(saveResource(database(), { ...crew, role }, { input }), { status: 403 });
  await assert.rejects(listResources(database(), crew, { archived: true }), { status: 403 });
});
test("enforces store and visibility on list queries and omits private storage paths", async () => {
  const db = database([base, { ...base, id: "restricted", visibility: "managers" }, { ...base, id: "other-store", store_id: "another-store" }, { ...base, id: "archived", archived: true }]);
  const rows = await listResources(db, crew);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, ID);
  assert.equal("object_path" in rows[0], false);
  assert.equal("store_id" in rows[0], false);
  assert.equal((await listResources(db, manager)).length, 2);
});
test("creates resources with server-owned store and actor fields", async () => {
  const db = database([]);
  await saveResource(db, manager, { input: { ...input, store_id: "attacker", created_by: "attacker" } });
  assert.equal(db.state.rows[0].store_id, "07462");
  assert.equal(db.state.rows[0].created_by, manager.employee_id);
});
test("does not allow empty resources", async () => {
  await assert.rejects(saveResource(database(), manager, { input: { ...input, notes: "", summary: "" } }), /description, notes, a link, or a file/);
});
test("uploads a file into a unique private store path", async () => {
  const db = database([]);
  const saved = await saveResource(db, manager, { input, file: file() });
  assert.equal(saved.file_name, "guide.pdf");
  assert.match(db.state.uploads[0].path, /^07462\/[\da-f-]+\/[\da-f-]+\.pdf$/);
  assert.equal(db.state.uploads[0].opts.upsert, false);
});
test("upload failure leaves metadata and old attachment intact", async () => {
  const db = database([{ ...base, object_path: "07462/old.pdf", file_name: "old.pdf" }], { failUpload: true });
  await assert.rejects(saveResource(db, manager, { id: ID, input: { ...input, version: 1 }, file: file() }), /Upload failed/);
  assert.equal(db.state.rows[0].object_path, "07462/old.pdf");
  assert.equal(db.state.removals.length, 0);
});
test("failed save cleans up the new file and preserves the old file", async () => {
  const db = database([{ ...base, object_path: "07462/old.pdf", file_name: "old.pdf" }], { failWrite: true });
  await assert.rejects(saveResource(db, manager, { id: ID, input: { ...input, version: 1 }, file: file() }), /Write failed/);
  assert.deepEqual(db.state.removals, [db.state.uploads[0].path]);
  assert.equal(db.state.rows[0].object_path, "07462/old.pdf");
});
test("file replacement removes the previous object only after metadata saves", async () => {
  const db = database([{ ...base, object_path: "07462/old.pdf", file_name: "old.pdf" }]);
  await saveResource(db, manager, { id: ID, input: { ...input, version: 1 }, file: file() });
  assert.deepEqual(db.state.removals, ["07462/old.pdf"]);
  assert.equal(db.state.rows[0].version, 2);
});
test("attachment removal is explicit", async () => {
  const db = database([{ ...base, object_path: "07462/old.pdf", file_name: "old.pdf" }]);
  await saveResource(db, manager, { id: ID, input: { ...input, version: 1 }, removeAttachment: true });
  assert.equal(db.state.rows[0].object_path, null);
  assert.deepEqual(db.state.removals, ["07462/old.pdf"]);
});
test("stale edits and concurrent writes are rejected without replacing files", async () => {
  await assert.rejects(saveResource(database([{ ...base, version: 2 }]), manager, { id: ID, input: { ...input, version: 1 } }), { status: 409 });
  const db = database([base], { race: true });
  await assert.rejects(saveResource(db, manager, { id: ID, input: { ...input, version: 1 }, file: file() }), { status: 409 });
  assert.deepEqual(db.state.removals, [db.state.uploads[0].path]);
});
test("cannot edit resources at another store", async () => {
  await assert.rejects(saveResource(database([{ ...base, store_id: "other" }]), manager, { id: ID, input: { ...input, version: 1 } }), { status: 404 });
});
test("archives and restores without deleting attachments", async () => {
  const db = database([{ ...base, object_path: "07462/guide.pdf" }]);
  const archived = await archiveResource(db, manager, ID, { archived: true, version: 1 });
  assert.equal(archived.archived, true);
  assert.equal((await listResources(db, crew)).length, 0);
  await assert.rejects(saveResource(db, manager, { id: ID, input: { ...input, version: 2 } }), { status: 409 });
  const restored = await archiveResource(db, manager, ID, { archived: false, version: 2 });
  assert.equal(restored.archived, false);
  assert.equal(db.state.rows[0].object_path, "07462/guide.pdf");
  assert.equal(db.state.removals.length, 0);
});
test("protects private, archived, and other-store downloads", async () => {
  for (const change of [{ visibility: "managers" }, { archived: true }, { store_id: "other" }]) {
    const db = database([{ ...base, object_path: "private.pdf", ...change }]);
    await assert.rejects(resourceDownload(db, crew, ID), { status: 404 });
    assert.equal(db.state.signatures.length, 0);
  }
});
test("authorized downloads expire after 60 seconds and force the original filename", async () => {
  const db = database([{ ...base, object_path: "07462/guide.pdf", file_name: "guide.pdf", visibility: "managers" }]);
  assert.match(await resourceDownload(db, manager, ID), /^https:/);
  assert.deepEqual(db.state.signatures[0], ["07462/guide.pdf", 60, { download: "guide.pdf" }]);
});
test("rejects cross-origin and missing-origin writes", () => {
  const request = (origin) => new Request("https://hub.example/api/resources", { headers: origin ? { origin } : {} });
  assert.throws(() => checkResourceOrigin(request("https://attacker.example")), { status: 403 });
  assert.throws(() => checkResourceOrigin(request()), { status: 403 });
  assert.doesNotThrow(() => checkResourceOrigin(request("https://hub.example")));
});

test("starts with the six approved subject tabs and keeps Learner Hub in Training", () => {
  assert.deepEqual(RESOURCE_CATEGORIES.map((category) => category.label), ["Equipment", "Training", "Operations", "Food & Menu", "Safety & Cleaning", "Policies & Contacts"]);
  assert.match(RESOURCE_CATEGORIES.find((category) => category.value === "training").description, /Learner Hub/);
  assert.equal(RESOURCE_CATEGORIES.some((category) => category.value === "learner_hub"), false);
});
test("normalizes preset and custom tags without duplicates", () => {
  assert.deepEqual(normalizeResourceTags([" sop ", "SOP", "manual", "Deep  cleaning", ""]), ["SOP", "Manual", "Deep cleaning"]);
  assert.throws(() => normalizeResourceTags("SOP"));
  assert.throws(() => normalizeResourceTags([{}]));
  assert.throws(() => normalizeResourceTags(["a".repeat(33)]));
  assert.throws(() => normalizeResourceTags(Array.from({ length: 13 }, (_, i) => `Tag ${i}`)));
});
test("filters by tags and searches renamed tab names and custom tags", () => {
  const categories = RESOURCE_CATEGORIES.map((category) => category.value === "equipment" ? { ...category, label: "Our machines" } : category);
  const rows = [{ ...base, tags: ["SOP", "Deep cleaning"] }];
  assert.equal(filterResources(rows, { tag: "sop" }).length, 1);
  assert.equal(filterResources(rows, { tag: "Manual" }).length, 0);
  assert.equal(filterResources(rows, { categories, search: "machines cleaning" }).length, 1);
});
test("validates tab names, uniqueness, and limits", () => {
  assert.throws(() => validateResourceCategories([]));
  assert.throws(() => validateResourceCategories([{ ...RESOURCE_CATEGORIES[0], label: " " }]));
  assert.throws(() => validateResourceCategories([RESOURCE_CATEGORIES[0], { ...RESOURCE_CATEGORIES[1], label: "equipment" }]), /unique/);
  assert.throws(() => validateResourceCategories([{ ...RESOURCE_CATEGORIES[0], value: "unsafe/value" }]));
  assert.throws(() => validateResourceCategories([{ ...RESOURCE_CATEGORIES[0], icon: "unknown" }]));
});
test("crew can read tabs but cannot change them", async () => {
  const db = database();
  assert.equal((await loadResourceCategories(db, crew)).categories.length, 6);
  await assert.rejects(saveResourceCategories(db, crew, { categories: RESOURCE_CATEGORIES, version: 1 }), { status: 403 });
  assert.equal(db.state.rpcCalls.length, 1);
});
test("saves added, renamed, and reordered tabs without changing resource identities", async () => {
  const db = database();
  const categories = [...RESOURCE_CATEGORIES].reverse().map((tab) => tab.value === "equipment" ? { ...tab, label: "Machines" } : tab);
  categories.push({ value: "custom_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "Local resources", description: "", icon: "folder" });
  const saved = await saveResourceCategories(db, manager, { categories, version: 1, store_id: "attacker-store" });
  assert.equal(saved.categories[0].value, "policies_contacts");
  assert.equal(saved.version, 2);
  assert.equal(db.state.rows[0].category, "equipment");
  assert.equal(db.state.rpcCalls.at(-1).args.p_store_id, "07462");
});
test("rejects tab deletion, changed identities, and stale saves", async () => {
  await assert.rejects(saveResourceCategories(database(), manager, { categories: RESOURCE_CATEGORIES.slice(1), version: 1 }), /cannot be removed/);
  await assert.rejects(saveResourceCategories(database(), manager, { categories: RESOURCE_CATEGORIES, version: 0 }), { status: 409 });
  await assert.rejects(saveResourceCategories(database([], { raceTabs: true }), manager, { categories: RESOURCE_CATEGORIES, version: 1 }), { status: 409 });
  await assert.rejects(saveResourceCategories(database(), manager, { categories: [...RESOURCE_CATEGORIES, { value: "invented", label: "Extra", description: "", icon: "folder" }], version: 1 }), /Invalid new tab/);
});
test("resources can use custom tabs from this store and persist document tags", async () => {
  const custom = { value: "custom_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "Local resources", description: "", icon: "folder" };
  const db = database([], { categories: [...RESOURCE_CATEGORIES, custom] });
  const saved = await saveResource(db, manager, { input: { ...input, category: custom.value, tags: ["sop", "Manual"] } });
  assert.deepEqual(saved.tags, ["SOP", "Manual"]);
  await assert.rejects(saveResource(database(), manager, { input: { ...input, category: custom.value } }), /Choose a tab/);
});
