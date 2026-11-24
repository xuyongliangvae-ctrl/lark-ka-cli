import test from "node:test";
import assert from "node:assert/strict";
import { executeIM } from "../src/domains/im.mjs";

const path = "/open-apis/im/v1/chats/search";
const search = (ctx, flags) => executeIM(ctx, "im", "+chat-search", flags);

test("HaiNeng chat search previews a v1 GET and sends the opaque cursor as a query parameter", async () => {
  const request = async (method, route, options) => ({
    method,
    route,
    ...options,
  });
  const ctx = {
    config: { brand: "cnooc" },
    identity: "user",
    dryRun: true,
    request,
  };
  assert.deepEqual(
    await search(ctx, {
      query: "team-name",
      "page-size": 12,
      "page-token": "opaque==",
    }),
    {
      method: "GET",
      route: path,
      query: { query: '"team-name"', page_size: 12, page_token: "opaque==" },
    },
  );
});

test("v1 results preserve chat IDs and pagination for employee and app identity", async () => {
  const item = { chat_id: "oc_team", name: "Team", external: false };
  for (const identity of ["user", "bot"]) {
    const ctx = {
      config: { brand: "custom", profileName: "cnooc" },
      identity,
      request: async (method, route, { query }) => {
        assert.equal(method, "GET");
        assert.equal(route, path);
        assert.deepEqual(query, { query: "Team", page_size: 20 });
        return { items: [item], has_more: true, page_token: "next" };
      },
    };
    assert.deepEqual(await search(ctx, { query: "Team" }), {
      chats: [item],
      has_more: true,
      page_token: "next",
    });
  }
});

test("v1 rejects unsupported filters, missing keywords and out-of-range pagination before making a request", async () => {
  const ctx = {
    config: { brand: "cnooc" },
    identity: "user",
    request: () => assert.fail("Rejected flags must not issue a request"),
  };
  for (const [key, value] of Object.entries({
    "search-types": "private",
    "member-ids": "ou_test",
    "sort-by": "update_time_desc",
    "is-manager": true,
    "disable-search-by-user": true,
    "exclude-muted": true,
  })) {
    await assert.rejects(
      search(ctx, { query: "Team", [key]: value }),
      new RegExp(`--${key}`),
    );
  }
  for (const input of ["", "  ", undefined, "x".repeat(65)])
    await assert.rejects(search(ctx, { query: input }), /--query/);
  await assert.rejects(
    search(ctx, { query: "Team", "page-size": 101 }),
    /--page-size/,
  );
});
