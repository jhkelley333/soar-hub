/**
 * Offline tests for the ecosure function's store scoping.
 *
 * Uses a fake Supabase client, so no network or credentials are needed.
 *
 * Run:  node test/ecosure/scope.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scopedStoreNumbers } from "../../netlify/functions/ecosure.js";

const STORES = [
  { id: "s1", number: 1001, district: "D1", area: "A1", region: "R1" },
  { id: "s2", number: 1002, district: "D1", area: "A1", region: "R1" },
  { id: "s3", number: 2001, district: "D2", area: "A2", region: "R1" },
  { id: "s4", number: 3001, district: "D3", area: "A3", region: "R2" },
];

function fakeSupa(visibleIds) {
  return {
    rpc: async () => ({ data: visibleIds }),
    from() {
      const f = {};
      const q = {
        select: () => q,
        order: () => q,
        range: () => q,
        eq: (col, val) => { f[col] = val; return q; },
        in: (_col, vals) => { f.ids = vals; return q; },
        then(resolve, reject) {
          let rows = STORES;
          if (f.ids) rows = rows.filter((s) => f.ids.includes(s.id));
          if (f["districts.name"]) rows = rows.filter((s) => s.district === f["districts.name"]);
          if (f["districts.areas.name"]) rows = rows.filter((s) => s.area === f["districts.areas.name"]);
          if (f["districts.areas.regions.name"]) rows = rows.filter((s) => s.region === f["districts.areas.regions.name"]);
          return Promise.resolve({ data: rows.map((s) => ({ number: s.number })) }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const params = (o = {}) => new URLSearchParams(o);
const d1Do = { id: "u-do", role: "do" };
const D1_IDS = ["s1", "s2"];

test("DO with no filters sees only their own stores", async () => {
  const got = await scopedStoreNumbers(fakeSupa(D1_IDS), d1Do, params());
  assert.deepEqual(got.sort(), ["1001", "1002"]);
});

test("DO filtering to their own district sees their stores", async () => {
  const got = await scopedStoreNumbers(fakeSupa(D1_IDS), d1Do, params({ district: "D1" }));
  assert.deepEqual(got.sort(), ["1001", "1002"]);
});

test("DO cannot widen scope with another district's filter", async () => {
  const got = await scopedStoreNumbers(fakeSupa(D1_IDS), d1Do, params({ district: "D3" }));
  assert.deepEqual(got, []);
});

test("DO cannot widen scope with a region filter", async () => {
  const got = await scopedStoreNumbers(fakeSupa(D1_IDS), d1Do, params({ region: "R1" }));
  assert.deepEqual(got.sort(), ["1001", "1002"]);
});

test("user with no store scope sees nothing, with or without filters", async () => {
  for (const role of ["do", "sdo", "rvp", "gm", "fbc"]) {
    const user = { id: "u-x", role };
    assert.deepEqual(await scopedStoreNumbers(fakeSupa([]), user, params()), []);
    assert.deepEqual(await scopedStoreNumbers(fakeSupa([]), user, params({ region: "R1" })), []);
  }
});

test("org-wide roles get null (no filter) when no filters are passed", async () => {
  for (const role of ["admin", "vp", "coo"]) {
    assert.equal(await scopedStoreNumbers(fakeSupa([]), { id: "u-a", role }, params()), null);
  }
});

test("org-wide roles can narrow by filter", async () => {
  const got = await scopedStoreNumbers(fakeSupa([]), { id: "u-a", role: "admin" }, params({ region: "R1" }));
  assert.deepEqual(got.sort(), ["1001", "1002", "2001"]);
});

test("multiple filters combine (AND)", async () => {
  const got = await scopedStoreNumbers(fakeSupa([]), { id: "u-a", role: "admin" }, params({ region: "R1", district: "D2" }));
  assert.deepEqual(got, ["2001"]);
});
