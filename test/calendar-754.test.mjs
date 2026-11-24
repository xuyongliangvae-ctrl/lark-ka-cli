import assert from "node:assert/strict";
import test from "node:test";
import { execute } from "../src/cli.mjs";
import { executeCollaboration } from "../src/domains/collaboration.mjs";

const calendarsPath = "/open-apis/calendar/v4/calendars";
const timeFlags = {
  start: "2026-11-22T00:00:00+08:00",
  end: "2026-11-23T00:00:00+08:00",
};
const timeQuery = { start_time: "1795276800", end_time: "1795363200" };

test("HaiNeng agenda dry run previews resolving the primary calendar ID", async () => {
  const result = await execute(
    ["calendar", "+agenda"],
    { ...timeFlags, "dry-run": true, as: "user" },
    { config: { brand: "cnooc", storageKey: "calendar-754-dry-run" } },
  );
  assert.deepEqual(
    result.data.requests.map(({ method, path, params }) => ({
      method,
      path,
      params,
    })),
    [
      { method: "POST", path: `${calendarsPath}/primary`, params: {} },
      {
        method: "GET",
        path: `${calendarsPath}/%3Cprimary_calendar_id%3E/events/instance_view`,
        params: timeQuery,
      },
    ],
  );
});

test("HaiNeng agenda fetches instances with the resolved calendar ID", async () => {
  const calendarId = "tenant.fixture@group.calendar.invalid";
  const event = { event_id: "fixture-event", status: "confirmed" };
  const requests = [];
  const ctx = {
    identity: "user",
    config: { brand: "cnooc" },
    request: async (method, path, options) => {
      requests.push({ method, path, query: options?.query });
      return method === "POST"
        ? { calendars: [{ calendar: { calendar_id: calendarId } }] }
        : { items: [event, { status: "cancelled" }] };
    },
  };

  const result = await executeCollaboration(
    ctx,
    "calendar",
    "+agenda",
    timeFlags,
  );
  assert.deepEqual(result, [event]);
  assert.deepEqual(requests, [
    { method: "POST", path: `${calendarsPath}/primary`, query: undefined },
    {
      method: "GET",
      path: `${calendarsPath}/${encodeURIComponent(calendarId)}/events/instance_view`,
      query: timeQuery,
    },
  ]);
});

test("HaiNeng agenda reports a missing calendar ID before fetching instances", async () => {
  const methods = [];
  const ctx = {
    identity: "user",
    config: { brand: "cnooc" },
    request: async (method) => {
      methods.push(method);
      return { calendars: [] };
    },
  };
  await assert.rejects(
    executeCollaboration(ctx, "calendar", "+agenda", timeFlags),
    { type: "api", message: "Primary calendar response has no calendar_id" },
  );
  assert.deepEqual(methods, ["POST"]);
});

test("explicit calendar IDs and the public primary alias use a single request", async () => {
  for (const [brand, flags, id] of [
    [
      "cnooc",
      { "calendar-id": "calendar@fixture.invalid" },
      "calendar@fixture.invalid",
    ],
    ["feishu", {}, "primary"],
  ]) {
    const requests = [];
    const ctx = {
      identity: "user",
      config: { brand },
      request: async (method, path) => {
        requests.push([method, path]);
        return { items: [] };
      },
    };
    await executeCollaboration(ctx, "calendar", "+agenda", {
      ...timeFlags,
      ...flags,
    });
    assert.deepEqual(requests, [
      [
        "GET",
        `${calendarsPath}/${encodeURIComponent(id)}/events/instance_view`,
      ],
    ]);
  }
});
