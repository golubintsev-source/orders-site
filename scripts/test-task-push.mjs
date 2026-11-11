import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../api/send-task-push.js", import.meta.url), "utf8");

const profiles = [
  { id: "author", email: "author@example.com", role: "admin" },
  { id: "admin", email: "admin@example.com", role: "admin" },
  { id: "executor-a", email: " First+task@Example.com ", role: "user" },
  { id: "executor-b", email: "second@example.com", role: "admin" },
  { id: "similar", email: "first+task@exampleXcom", role: "admin" },
];

async function invoke(record, type = "INSERT") {
  const requests = [];
  const notifications = [];
  const module = {};
  runInNewContext(source, {
    module,
    Buffer,
    process: { env: {
      SUPABASE_URL: "https://db.example.com",
      SUPABASE_SERVICE_ROLE_KEY: "test-key",
      VAPID_PUBLIC_KEY: "test-public-key",
      VAPID_PRIVATE_KEY: "test-private-key",
      PUSH_WEBHOOK_SECRET: "test-secret",
    } },
    require(name) {
      assert.equal(name, "web-push");
      return {
        setVapidDetails() {},
        async sendNotification(subscription, payload) {
          notifications.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
        },
      };
    },
    async fetch(input) {
      const url = new URL(input);
      requests.push(url.pathname);
      if (url.pathname.endsWith("/profiles")) {
        assert.equal(url.searchParams.get("role"), null);
        const filter = url.searchParams.get("email");
        assert.ok(filter?.startsWith("imatch."));
        const pattern = filter.slice("imatch.".length).replaceAll("[[:space:]]", "\\s");
        const matcher = new RegExp(pattern, "i");
        return Response.json(profiles.filter(({ email }) => matcher.test(email)));
      }
      assert.ok(url.pathname.endsWith("/push_subscriptions"));
      const filter = url.searchParams.get("user_id");
      assert.ok(filter?.startsWith("in.(") && filter.endsWith(")"));
      const ids = filter.slice("in.(".length, -1).split(",");
      return Response.json(profiles.filter(({ id }) => ids.includes(id)).map(({ id }) => ({
        id, endpoint: `https://push.example.com/${id}`, p256dh: "test-key", auth: "test-auth",
      })));
    },
  });

  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await module.exports({
    method: "POST",
    headers: { "x-push-webhook-secret": "test-secret" },
    body: { type, record },
  }, response);
  assert.equal(response.statusCode, 200);
  return { requests, notifications, body: response.body };
}

test("sends only to assigned executors regardless of role", async () => {
  const result = await invoke({
    id: 10, order_id: 20, author_login: "author@example.com",
    executor_emails: ["FIRST+TASK@example.com", "second@example.com", " second@example.com "],
  });
  assert.equal(result.body.sent, 2);
  assert.deepEqual(result.notifications.map(({ endpoint }) => endpoint), [
    "https://push.example.com/executor-a", "https://push.example.com/executor-b",
  ]);
  assert.equal(result.notifications[0].payload.orderId, 20);
});

test("supports a standalone task assigned to its author", async () => {
  const result = await invoke({
    id: 11, order_id: null, author_login: "author@example.com",
    executor_emails: ["author@example.com"],
  });
  assert.equal(result.body.sent, 1);
  assert.equal(result.notifications[0].endpoint, "https://push.example.com/author");
  assert.equal(result.notifications[0].payload.orderId, null);
});

test("skips tasks without assigned executors and skips update events", async () => {
  const unassigned = await invoke({ id: 12, order_id: 20, executor_emails: [null, " "] });
  const updated = await invoke({ id: 12, executor_emails: ["second@example.com"] }, "UPDATE");
  for (const result of [unassigned, updated]) {
    assert.equal(result.body.sent, 0);
    assert.deepEqual(result.requests, []);
    assert.deepEqual(result.notifications, []);
  }
});
