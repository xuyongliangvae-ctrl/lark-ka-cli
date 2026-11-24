import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createContext } from "../src/context.mjs";
import { executeTables } from "../src/domains/tables.mjs";

const dashboardFlags = { "base-token": "app1", "page-size": 1 };
const searchFlags = {
  "base-token": "app1",
  "table-id": "tbl1",
  keyword: "missing",
  "search-field": ["Name"],
  "field-id": ["Name"],
  format: "json",
};
const emptyPage = { total: 0, has_more: false, page_token: "end" };

async function fakeContext(t, flags = {}) {
  const configDir = await mkdtemp(path.join(tmpdir(), "hn-base-empty-"));
  const original = process.env.LARK_KA_CONFIG_DIR;
  process.env.LARK_KA_CONFIG_DIR = configDir;
  t.after(async () => {
    if (original === undefined) delete process.env.LARK_KA_CONFIG_DIR;
    else process.env.LARK_KA_CONFIG_DIR = original;
    await rm(configDir, { recursive: true, force: true });
  });
  return createContext(
    { as: "user", ...flags },
    { config: { brand: "cnooc" } },
  );
}

test("HaiNeng dashboard and search responses identify empty results without an array", async (t) => {
  const ctx = await fakeContext(t);
  ctx.request = async () => emptyPage;
  assert.deepEqual(
    await executeTables(ctx, "base", "+dashboard-list", dashboardFlags),
    { ...emptyPage, dashboards: [] },
  );

  ctx.request = async () => ({ ...emptyPage, items: null });
  assert.deepEqual(
    await executeTables(ctx, "base", "+record-search", searchFlags),
    { ...emptyPage, items: [], fields: ["Name"], record_id_list: [], data: [] },
  );
});

test("HaiNeng page-all normalizes empty pages before aggregating rows", async (t) => {
  const ctx = await fakeContext(t, { "page-all": true });
  const cases = [
    ["+dashboard-list", dashboardFlags, "dashboards", undefined],
    ["+record-search", searchFlags, "items", null],
  ];
  for (const [command, flags, key, value] of cases) {
    let calls = 0;
    ctx.request = async (_method, _url, options) => {
      calls++;
      assert.equal(options.normalizePage, undefined);
      return { ...emptyPage, [key]: value };
    };
    const result = await executeTables(ctx, "base", command, {
      ...flags,
      "page-all": true,
    });
    assert.equal(calls, 1);
    assert.deepEqual(result[key], []);
    assert.equal(result.has_more, false);
    assert.equal(result.total, 0);
    assert.equal(result.page_token, "end");
  }
});

test("HaiNeng list handlers still reject malformed collections", async (t) => {
  const ctx = await fakeContext(t, { "page-all": true });
  const cases = [
    { ...emptyPage, dashboards: {} },
    { ...emptyPage, dashboards: "broken" },
    { ...emptyPage, has_more: true },
    { ...emptyPage, total: 2, dashboards: null },
  ];
  for (const response of cases) {
    ctx.request = async () => response;
    for (const pageAll of [false, true]) {
      await assert.rejects(
        executeTables(ctx, "base", "+dashboard-list", {
          ...dashboardFlags,
          "page-all": pageAll,
        }),
        /requires the dashboards array/,
      );
    }
  }
});
