import test from "node:test";
import assert from "node:assert/strict";
import { executeContent } from "../src/domains/content.mjs";

const suite = "/open-apis/suite/docs-api/search/object";
const v2 = "/open-apis/search/v2/doc_wiki/search";

function context(config = { brand: "custom", profileName: "cnooc" }, respond) {
  const calls = [];
  return {
    identity: "user",
    config,
    calls,
    async request(method, path, options) {
      calls.push({ method, path, ...options });
      return respond
        ? respond(options.body)
        : { docs_entities: [], has_more: false, total: 0 };
    },
  };
}

for (const service of ["docs", "drive"]) {
  test(`${service} +search previews the UAT endpoint and retains public/custom v2`, async () => {
    for (const [config, route] of [
      [{ brand: "custom", profileName: "cnooc" }, suite],
      [{ brand: "feishu" }, v2],
      [{ brand: "custom", profileName: "another-customer" }, v2],
      [{ brand: "cnooc", documentSearchApi: "v2" }, v2],
      [{ brand: "custom", documentSearchApi: "suite" }, suite],
    ]) {
      const ctx = context(config);
      const result = await executeContent(
        { ...ctx, dryRun: true },
        service,
        "+search",
        { query: "周报" },
      );
      assert.equal(ctx.calls.length, 0);
      const [req] = result.requests;
      assert.equal(req.method, "POST");
      assert.equal(req.path, route);
      if (route === suite)
        assert.deepEqual(req.body, {
          search_key: "周报",
          count: 15,
          offset: 0,
        });
      else assert.equal(req.body.query, "周报");
    }
  });
}

test("native HaiNeng document writes reject explicit v2 before any request", async () => {
  for (const config of [
    { brand: "custom", profileName: "cnooc", docsBackend: "native" },
    { brand: "cnooc" },
  ]) {
    const ctx = context(config);
    await assert.rejects(
      executeContent(ctx, "docs", "+create", {
        title: "Record",
        content: "text",
        "api-version": "v2",
      }),
      (e) => e.type === "unsupported" && /--api-version v1/.test(e.message),
    );
    assert.equal(ctx.calls.length, 0);
    const result = await executeContent(
      { ...ctx, dryRun: true },
      "docs",
      "+create",
      {
        title: "Record",
        content: "text",
        "doc-format": "text",
        "api-version": "v1",
      },
    );
    assert.equal(result.requests[0].path, "/open-apis/docx/v1/documents");
  }
});

test("explicitly configured extended document backends remain available on HaiNeng", async () => {
  for (const [docsBackend, flags, expected] of [
    ["docs-ai", { "api-version": "v2" }, "/open-apis/docs_ai/v1/documents"],
    ["mcp", {}, "https://mcp.example.invalid/endpoint"],
  ]) {
    const ctx = context({
      brand: "custom",
      profileName: "cnooc",
      docsBackend,
      mcpUrl: "https://mcp.example.invalid/endpoint",
    });
    const cmd = docsBackend === "mcp" ? "+fetch" : "+create";
    const args =
      docsBackend === "mcp"
        ? { doc: "doc_123" }
        : { title: "Record", content: "text" };
    const result = await executeContent({ ...ctx, dryRun: true }, "docs", cmd, {
      ...args,
      ...flags,
    });
    assert.equal(result.requests[0].path, expected);
  }
});

test("suite drive search converts only equivalent owner, chat and document filters", async () => {
  const row = {
    docs_token: "ABC",
    docs_type: "doc",
    title: "工作记录",
    owner_id: "ou_a",
  };
  const ctx = context(undefined, () => ({
    docs_entities: [row],
    total: 7,
    has_more: true,
  }));
  const flags = {
    query: "工作",
    "creator-ids": "ou_a,ou_b",
    "chat-ids": "oc_a",
    "doc-types": "DOC,sheet",
    "page-token": "3",
  };
  const result = await executeContent(ctx, "drive", "+search", flags);
  assert.deepEqual(ctx.calls, [
    {
      method: "POST",
      path: suite,
      body: {
        search_key: "工作",
        owner_ids: ["ou_a", "ou_b"],
        chat_ids: ["oc_a"],
        docs_types: ["doc", "sheet"],
        count: 15,
        offset: 3,
      },
    },
  ]);
  assert.deepEqual(result, {
    docs_entities: [row],
    has_more: true,
    total: 7,
    page_token: "4",
  });
  ctx.config.userOpenId = "ou_current";
  await executeContent(ctx, "drive", "+search", { query: "工作", mine: true });
  assert.deepEqual(ctx.calls.at(-1).body.owner_ids, ["ou_current"]);
});

test("suite docs accepts only the legacy filter object including @file resolution", async () => {
  const ctx = context();
  ctx.input = async (path) => {
    assert.equal(path, "@./filter.json");
    return JSON.stringify({
      owner_ids: ["ou_x"],
      docs_types: ["doc"],
      chat_ids: ["oc_x"],
    });
  };
  await executeContent(ctx, "docs", "+search", {
    query: "project",
    filter: "@./filter.json",
  });
  assert.deepEqual(ctx.calls[0].body, {
    search_key: "project",
    count: 15,
    offset: 0,
    owner_ids: ["ou_x"],
    docs_types: ["doc"],
    chat_ids: ["oc_x"],
  });
});

test("suite rejects incompatible requests before sending any request", async () => {
  const ctx = context();
  for (const [service, extra, expected] of [
    ["docs", { query: " " }, /nonempty --query/],
    ["drive", { "creator-ids": "ou_other", mine: true }, /mutually exclusive/],
    [
      "docs",
      { filter: '{"doc_filter":{"folder_tokens":["x"]}}' },
      /Unsupported suite search filter/,
    ],
    ["docs", { filter: '{"owner_ids":"ou_a"}' }, /owner_ids must be/],
    [
      "drive",
      { "folder-tokens": "PRIVATE_FOLDER" },
      /--folder-tokens is not supported/,
    ],
    ["drive", { "only-title": true }, /--only-title is not supported/],
    ["drive", { "doc-types": "docx" }, /Suite document types/],
    ["drive", { "page-size": "51" }, /--page-size/],
    ["drive", { "page-token": "v2opaque" }, /--page-token/],
    ["drive", { "page-token": "199" }, /offset \+ count/],
    ["drive", { "page-all": true, "page-size": "0" }, /positive/],
  ])
    await assert.rejects(
      executeContent(ctx, service, "+search", { query: "related", ...extra }),
      expected,
    );
  await assert.rejects(
    executeContent({ ...ctx, identity: "bot" }, "docs", "+search", {
      query: "private",
    }),
    /--as user/,
  );
  await assert.rejects(
    executeContent(ctx, "drive", "+search", { query: "project", mine: true }),
    /known logged-in user/,
  );
  assert.equal(ctx.calls.length, 0);
});

test("suite supports count-only mode and guards against unadvanceable page-all", async () => {
  const ctx = context(undefined, () => ({
    docs_entities: [],
    has_more: true,
    total: 87,
  }));
  const zero = await executeContent(ctx, "docs", "+search", {
    query: "周报",
    "page-size": 0,
  });
  assert.equal(ctx.calls[0].body.count, 0);
  assert.equal(zero.total, 87);
  await assert.rejects(
    executeContent(ctx, "docs", "+search", { query: "周报", "page-all": true }),
    /without advancing/,
  );
  assert.equal(ctx.calls.length, 2);
});

test("suite aggregation honors a short page, a limit and a resumable offset", async () => {
  const ctx = context(undefined, ({ offset }) => ({
    docs_entities: [{ docs_token: `doc${offset}` }],
    has_more: offset < 3,
    total: 4,
  }));
  const result = await executeContent(ctx, "docs", "+search", {
    query: "周报",
    "page-size": 2,
    "page-all": true,
    "page-limit": 2,
  });
  assert.deepEqual(
    result.docs_entities.map((r) => r.docs_token),
    ["doc0", "doc1"],
  );
  assert.equal(result.has_more, true);
  assert.equal(result.page_token, "2");
  const resumed = await executeContent(ctx, "docs", "+search", {
    query: "周报",
    "page-token": result.page_token,
    "page-all": true,
  });
  assert.deepEqual(
    resumed.docs_entities.map((r) => r.docs_token),
    ["doc2", "doc3"],
  );
  assert.equal(resumed.has_more, false);
  assert.equal(resumed.page_token, undefined);
});

test("suite stops before the documented 200 window even for unlimited pagination", async () => {
  const ctx = context(undefined, ({ offset, count }) => ({
    docs_entities: Array.from({ length: count }, (_, i) => ({
      docs_token: `doc${offset + i}`,
    })),
    total: 502,
    has_more: true,
  }));
  const result = await executeContent(ctx, "drive", "+search", {
    query: "周报",
    "page-size": 50,
    "page-all": true,
    "page-limit": 0,
  });
  assert.deepEqual(
    ctx.calls.map(({ body }) => [body.offset, body.count]),
    [
      [0, 50],
      [50, 50],
      [100, 50],
      [150, 49],
    ],
  );
  assert.equal(result.docs_entities.length, 199);
  assert.equal(result.total, 502);
  assert.equal(result.has_more, true);
  assert.equal(result.truncated, true);
  assert.equal(result.page_token, undefined);
});
