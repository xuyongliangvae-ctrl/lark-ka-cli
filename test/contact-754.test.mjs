import assert from "node:assert/strict";
import test from "node:test";
import { executeCollaboration } from "../src/domains/collaboration.mjs";

function fixture(
  responses,
  config = { capabilities: { contactSearch: "v1" } },
) {
  const calls = [];
  const ctx = {
    config,
    identity: "user",
    request: async (method, path, options) => {
      calls.push({ method, path, ...options });
      assert.ok(calls.length <= responses.length, "unexpected API call");
      return responses[calls.length - 1];
    },
  };
  return {
    calls,
    run: (flags) => executeCollaboration(ctx, "contact", "+search-user", flags),
  };
}

test("private v1 user search preserves IDs and uses the supplied continuation token", async () => {
  const row = {
    open_id: "ou_alice",
    user_id: "employee_a",
    en_name: "Alice",
    department_ids: ["od_1", "od_2"],
  };
  const { calls, run } = fixture([
    { users: [row], has_more: true, page_token: "next cursor" },
  ]);
  const result = await run({
    query: " Alice ",
    "page-token": "previous/+",
    "page-size": "200",
  });
  assert.deepEqual(calls, [
    {
      method: "GET",
      path: "/open-apis/search/v1/user",
      query: { query: "Alice", page_size: 200, page_token: "previous/+" },
    },
  ]);
  assert.deepEqual(result, {
    users: [{ ...row, localized_name: "Alice", department: "od_1,od_2" }],
    has_more: true,
    page_token: "next cursor",
  });
});

test("v1 auto-pagination accumulates users and preserves a resumable cursor at the page limit", async () => {
  const { calls, run } = fixture([
    {
      users: [{ open_id: "ou_a", name: "甲" }],
      has_more: true,
      page_token: "second",
    },
    {
      users: [{ open_id: "ou_b", name: "乙" }],
      has_more: true,
      page_token: "third",
    },
  ]);
  const result = await run({
    query: "名字",
    "page-all": true,
    "page-limit": 2,
  });
  assert.deepEqual(
    calls.map((x) => x.query.page_token),
    [undefined, "second"],
  );
  assert.deepEqual(
    result.users.map((x) => x.localized_name),
    ["甲", "乙"],
  );
  assert.equal(result.page_token, "third");
  assert.equal(result.has_more, true);
});

test("private contact search rejects unsupported filters and invalid pagination before any call", async () => {
  const { calls, run } = fixture([]);
  for (const invalid of [
    { "has-chatted": true },
    { lang: "en_us" },
    { queries: "one,two" },
    { "user-ids": "ou_a" },
    { query: " " },
    { "page-size": 201 },
    { "page-token": true },
    { "page-limit": 2 },
  ])
    await assert.rejects(run({ query: "员工", ...invalid }), {
      type: "validation",
    });
  assert.equal(calls.length, 0);
});

test("v1 auto-pagination stops when a service repeats or omits the next cursor", async () => {
  for (const token of ["again", ""]) {
    const { calls, run } = fixture([
      { users: [], has_more: true, page_token: token },
    ]);
    await assert.rejects(
      run({ query: "员工", "page-all": true, "page-token": "again" }),
      { type: "api" },
    );
    assert.equal(calls.length, 1);
  }
});
