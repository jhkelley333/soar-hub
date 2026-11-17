/**
 * Offline tests for the ecosure function's paged reads.
 *
 * The fake table enforces a 1,000-row response cap like PostgREST, so a read
 * that does not page comes back truncated.
 *
 * Run:  node test/ecosure/paging.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAll } from "../../netlify/functions/ecosure.js";

const CAP = 1000;

function fakeTable(rows, { failOnCall } = {}) {
  let calls = 0;
  const make = () => {
    let subset = rows;
    let window = [0, CAP - 1];
    const q = {
      in: (col, vals) => { subset = subset.filter((r) => vals.includes(r[col])); return q; },
      range: (from, to) => { window = [from, to]; return q; },
      then(resolve, reject) {
        calls += 1;
        if (calls === failOnCall) {
          return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
        }
        const page = subset.slice(window[0], Math.min(window[1] + 1, window[0] + CAP));
        return Promise.resolve({ data: page, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return { make, calls: () => calls };
}

const findings = (n) => Array.from({ length: n }, (_, i) => ({ id: i, store_number: String(1000 + (i % 450)) }));

test("reads every row past the 1,000-row cap", async () => {
  const t = fakeTable(findings(2500));
  const { data, error } = await fetchAll(t.make);
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.equal(new Set(data.map((r) => r.id)).size, 2500);
  assert.equal(t.calls(), 3);
});

test("an exact multiple of the page size is read whole", async () => {
  const { data } = await fetchAll(fakeTable(findings(2000)).make);
  assert.equal(data.length, 2000);
});

test("a short table takes a single request", async () => {
  const t = fakeTable(findings(12));
  const { data } = await fetchAll(t.make);
  assert.equal(data.length, 12);
  assert.equal(t.calls(), 1);
});

test("a long .in() list is chunked and each chunk is paged", async () => {
  const rows = findings(4500); // 450 stores x 10 findings
  const wanted = Array.from({ length: 450 }, (_, i) => String(1000 + i));
  const t = fakeTable(rows);
  const { data } = await fetchAll(t.make, "store_number", wanted);
  assert.equal(data.length, 4500);
  assert.equal(new Set(data.map((r) => r.id)).size, 4500);
});

test(".in() restricts rows to the requested values", async () => {
  const { data } = await fetchAll(fakeTable(findings(4500)).make, "store_number", ["1000", "1001"]);
  assert.equal(data.length, 20);
  assert.ok(data.every((r) => r.store_number === "1000" || r.store_number === "1001"));
});

test("an empty .in() list returns no rows without querying", async () => {
  const t = fakeTable(findings(50));
  const { data } = await fetchAll(t.make, "store_number", []);
  assert.deepEqual(data, []);
  assert.equal(t.calls(), 0);
});

test("an error on a later page is surfaced, not swallowed", async () => {
  const { data, error } = await fetchAll(fakeTable(findings(2500), { failOnCall: 2 }).make);
  assert.equal(data, null);
  assert.equal(error.message, "boom");
});
