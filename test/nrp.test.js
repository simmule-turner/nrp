"use strict";
// Run with: node test/nrp.test.js
// No npm install needed — uses only Node's built-in test runner (node:test)
// and assert module, deliberately, since this environment has no network
// access to install a real framework and the app itself has no build step
// to hang one off of.
//
// SCOPE — what this does and doesn't cover, honestly:
// These are the pure, side-effect-free functions extracted directly from
// nrp.html (see extract.js) — no DOM, no IndexedDB, no fetch. That's most
// of what's realistically testable without a browser environment (jsdom/
// fake-indexeddb would need npm install, which isn't available here).
// NOT covered: feed XML parsing, HTML sanitization, UI rendering, sync
// logic, IndexedDB operations, or anything else that touches DOMParser,
// indexedDB, fetch, or the DOM — all real, non-trivial gaps, not omissions
// by accident. If a proper build/test pipeline becomes available later,
// those are the natural next things to add, most likely via jsdom.
//
// Because these are extracted from the real file at test-run time (not
// hand-copied into this file), the tests always run against whatever
// nrp.html actually contains right now — editing a covered function without
// updating these tests can't silently leave them testing stale code.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { extractFunctionSource } = require("./extract.js");

const html = fs.readFileSync(path.join(__dirname, "..", "nrp.html"), "utf8");

const FUNCTIONS = [
  "makeUid",
  "escapeHtml",
  "escapeAttr",
  "mbLimitToBytes",
  "hashString",
  "buildHeadersFromList",
  "selectEntriesToPurge"
];

function loadFunctions() {
  const src = FUNCTIONS.map(n => extractFunctionSource(html, n)).join("\n\n");
  const ctor = new Function(src + "\n\nreturn {" + FUNCTIONS.join(",") + "};");
  return ctor();
}

const lib = loadFunctions();

test("extraction: every target function was found and is callable", () => {
  for (const name of FUNCTIONS) {
    assert.equal(typeof lib[name], "function", `${name} should be a function`);
  }
});

test("makeUid: builds the composite accountId+rawId key", () => {
  assert.equal(lib.makeUid("acc1", "feed42"), "acc1___feed42");
  assert.equal(lib.makeUid("", ""), "___");
});

test("makeUid: distinct inputs never collide with each other's separator", () => {
  // The whole point of centralizing this — two different (accountId, rawId)
  // pairs should never produce the same uid.
  const a = lib.makeUid("acc1", "1_23");
  const b = lib.makeUid("acc1_1", "23");
  assert.notEqual(a, b, "uid construction should not be ambiguous across the separator");
});

test("escapeHtml: escapes the five dangerous characters", () => {
  assert.equal(lib.escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(lib.escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
  assert.equal(lib.escapeHtml(""), "");
  assert.equal(lib.escapeHtml(null), "");
  assert.equal(lib.escapeHtml(undefined), "");
});

test("escapeHtml: does not double-escape already-safe text", () => {
  assert.equal(lib.escapeHtml("plain text, no markup"), "plain text, no markup");
});

test("escapeAttr: currently an alias for escapeHtml", () => {
  // Documented as semantically-distinct-but-identical-implementation in the
  // codebase — this test exists specifically so that if that ever changes
  // (e.g. attribute-context escaping needs to diverge from text-context
  // escaping), it's a deliberate, visible change rather than a silent one.
  assert.equal(lib.escapeAttr('"quoted" & <tagged>'), lib.escapeHtml('"quoted" & <tagged>'));
});

test("mbLimitToBytes: converts MB to bytes", () => {
  assert.equal(lib.mbLimitToBytes(8), 8 * 1024 * 1024);
  assert.equal(lib.mbLimitToBytes(0.5), Math.round(0.5 * 1024 * 1024));
});

test("mbLimitToBytes: -1 and invalid input both mean unlimited (-1)", () => {
  assert.equal(lib.mbLimitToBytes(-1), -1);
  assert.equal(lib.mbLimitToBytes(undefined), -1);
  assert.equal(lib.mbLimitToBytes(null), -1);
  assert.equal(lib.mbLimitToBytes(""), -1);
  assert.equal(lib.mbLimitToBytes(-5), -1, "negative-but-not-exactly--1 should still mean unlimited, not a huge negative byte count");
  assert.equal(lib.mbLimitToBytes(NaN), -1);
});

test("hashString: deterministic (same input -> same output)", () => {
  assert.equal(lib.hashString("hello world"), lib.hashString("hello world"));
});

test("hashString: different input very likely produces different output", () => {
  assert.notEqual(lib.hashString("hello"), lib.hashString("world"));
});

test("hashString: never throws on empty string", () => {
  assert.doesNotThrow(() => lib.hashString(""));
});

test("buildHeadersFromList: converts {key,value} rows into a plain object", () => {
  const out = lib.buildHeadersFromList([
    { key: "Authorization", value: "Bearer abc" },
    { key: "X-Custom", value: "1" }
  ]);
  assert.deepEqual(out, { "Authorization": "Bearer abc", "X-Custom": "1" });
});

test("buildHeadersFromList: skips rows with no key, tolerates missing value", () => {
  const out = lib.buildHeadersFromList([
    { key: "", value: "ignored" },
    { key: "X-Only-Key" }
  ]);
  assert.deepEqual(out, { "X-Only-Key": "" });
});

test("buildHeadersFromList: handles null/undefined list gracefully", () => {
  assert.deepEqual(lib.buildHeadersFromList(null), {});
  assert.deepEqual(lib.buildHeadersFromList(undefined), {});
  assert.deepEqual(lib.buildHeadersFromList([]), {});
});

// ---- selectEntriesToPurge: the purge/reap decision logic ----
// This is the one piece of real domain logic in this suite (extracted
// specifically to make this possible — see the comment above its
// definition in nrp.html). Never touches starred/unread status itself;
// by design the caller (purgeFeedEntries) is responsible for only ever
// passing already-filtered read+non-starred candidates in.

function mkEntry(id, daysAgo) {
  return { id, publishedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString() };
}

test("selectEntriesToPurge: both rules disabled (-1) purges nothing", () => {
  const candidates = [mkEntry("a", 1000)];
  const result = lib.selectEntriesToPurge(candidates, { purgeAfterDays: -1, maxEntriesPerFeed: -1 });
  assert.deepEqual(result, []);
});

test("selectEntriesToPurge: age rule purges only entries older than the cutoff", () => {
  const candidates = [mkEntry("old", 40), mkEntry("new", 5)];
  const result = lib.selectEntriesToPurge(candidates, { purgeAfterDays: 30, maxEntriesPerFeed: -1 });
  assert.deepEqual(result.map(e => e.id), ["old"]);
});

test("selectEntriesToPurge: age rule purgeAfterDays=0 purges everything published before this exact moment", () => {
  const candidates = [mkEntry("yesterday", 1)];
  const result = lib.selectEntriesToPurge(candidates, { purgeAfterDays: 0, maxEntriesPerFeed: -1 });
  assert.deepEqual(result.map(e => e.id), ["yesterday"]);
});

test("selectEntriesToPurge: cap rule keeps the newest N, purges the rest", () => {
  const candidates = [mkEntry("newest", 1), mkEntry("middle", 10), mkEntry("oldest", 20)];
  const result = lib.selectEntriesToPurge(candidates, { purgeAfterDays: -1, maxEntriesPerFeed: 2 });
  assert.deepEqual(result.map(e => e.id), ["oldest"]);
});

test("selectEntriesToPurge: cap rule with count under the limit purges nothing", () => {
  const candidates = [mkEntry("a", 1), mkEntry("b", 2)];
  const result = lib.selectEntriesToPurge(candidates, { purgeAfterDays: -1, maxEntriesPerFeed: 5 });
  assert.deepEqual(result, []);
});

test("selectEntriesToPurge: both rules active — an entry matching either gets purged, no duplicates", () => {
  const candidates = [
    mkEntry("veryOld", 100),   // matches age rule
    mkEntry("recentButOver", 2), // matches cap rule only (pushed out by count)
    mkEntry("keep1", 1),
    mkEntry("keep2", 0.5)
  ];
  const result = lib.selectEntriesToPurge(candidates, { purgeAfterDays: 30, maxEntriesPerFeed: 2 });
  const ids = result.map(e => e.id).sort();
  assert.deepEqual(ids, ["recentButOver", "veryOld"]);
  assert.equal(new Set(ids).size, ids.length, "no entry should appear twice even if it matches both rules");
});

test("selectEntriesToPurge: entries with an unparseable publishedAt are never purged by the age rule", () => {
  const candidates = [{ id: "bad-date", publishedAt: "not-a-date" }];
  const result = lib.selectEntriesToPurge(candidates, { purgeAfterDays: 30, maxEntriesPerFeed: -1 });
  assert.deepEqual(result, [], "an entry we can't determine the age of should be left alone, not treated as infinitely old");
});

test("selectEntriesToPurge: empty candidate list always returns empty, regardless of settings", () => {
  assert.deepEqual(lib.selectEntriesToPurge([], { purgeAfterDays: 0, maxEntriesPerFeed: 0 }), []);
});
