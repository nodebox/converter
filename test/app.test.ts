// Runs the Worker's handler against an in-memory cache and rate limiter, with the Claude API stubbed.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { handle, readRequest, type Env } from "../src/app.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const body = {
  language: "python",
  filename: "ratio.py",
  source: "def ratio(a, b):\n    return a / b\n",
  functions: [{ name: "ratio", ports: [{ name: "a", type: "int" }, { name: "b", type: "int" }], outputType: "int" }],
};

const good = {
  module: "export function ratio(a, b) {\n  return Math.floor(a / b);\n}\n",
  functions: [{ name: "ratio", status: "converted", notes: "" }],
  suspectedBugs: [{ function: "ratio", description: "Dividing by zero stops the node.", fix: "Return 0 when b is 0." }],
  warnings: [],
};

/** Answers Claude API calls with the given results in turn, and counts the calls. */
function stubClaude(...results: unknown[]) {
  const calls: unknown[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const r = results[Math.min(calls.length - 1, results.length - 1)];
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(r) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 20 } }));
  }) as typeof fetch;
  return calls;
}

function makeEnv(limit = true): Env & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    ANTHROPIC_API_KEY: "test",
    CACHE: {
      async get(key: string, type: string) {
        const v = store.get(key);
        return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
    RATE_LIMITER: { limit: async () => ({ success: limit }) } as RateLimit,
  };
}

const post = (b: unknown) => new Request("https://converter.test/v1/convert", { method: "POST", body: JSON.stringify(b) });

test("converts, reports suspected bugs, and serves the second request from the cache", async () => {
  const calls = stubClaude(good);
  const env = makeEnv();
  const first = await handle(post(body), env, "prompt");
  assert.equal(first.status, 200);
  const r1 = (await first.json()) as Record<string, unknown>;
  assert.equal(r1.module, good.module);
  assert.deepEqual(r1.suspectedBugs, good.suspectedBugs);
  assert.deepEqual(r1.problems, []);
  assert.equal(r1.cached, false);
  assert.match(String(r1.promptVersion), /^[0-9a-f]{12}$/);

  const r2 = (await (await handle(post(body), env, "prompt")).json()) as Record<string, unknown>;
  assert.equal(r2.cached, true);
  assert.equal(r2.module, good.module);
  assert.equal(calls.length, 1);
});

test("a failed check is sent back once, with the problems", async () => {
  const calls = stubClaude({ ...good, module: "export function other() {}" }, good);
  const r = (await (await handle(post(body), makeEnv(), "prompt")).json()) as Record<string, unknown>;
  assert.deepEqual(r.problems, []);
  assert.equal(calls.length, 2);
  const retry = calls[1] as { messages: { content: string }[] };
  assert.match(retry.messages[2].content, /Missing export: ratio/);
});

test("a conversion that still fails its checks is returned with its problems and not cached", async () => {
  stubClaude({ ...good, module: "export function other() {}" });
  const env = makeEnv();
  const r = (await (await handle(post(body), env, "prompt")).json()) as Record<string, unknown>;
  assert.deepEqual(r.problems, ["Missing export: ratio"]);
  assert.equal(env.store.size, 0);
});

test("the rate limit applies to conversions that reach the model", async () => {
  stubClaude(good);
  const res = await handle(post(body), makeEnv(false), "prompt");
  assert.equal(res.status, 429);
});

test("bad requests are refused with a reason", async () => {
  assert.equal(readRequest({ ...body, language: "ruby" }), 'language must be "python" or "clojure".');
  assert.match(String(readRequest({ ...body, source: "x".repeat(200_000) })), /larger than/);
  assert.equal(readRequest({ ...body, functions: [{ name: "a b", ports: [] }] }), "Each function needs a name and a list of ports.");
  const res = await handle(new Request("https://converter.test/v1/convert", { method: "POST", body: "nope" }), makeEnv(), "prompt");
  assert.equal(res.status, 400);
  assert.equal((await handle(new Request("https://converter.test/v1/convert"), makeEnv(), "prompt")).status, 405);
});

test("an API failure becomes a 502 without the source in the log", async () => {
  globalThis.fetch = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
  const logged: string[] = [];
  const orig = console.error;
  console.error = (m: string) => logged.push(m);
  try {
    const res = await handle(post(body), makeEnv(), "prompt");
    assert.equal(res.status, 502);
  } finally {
    console.error = orig;
  }
  assert.ok(!logged.join("").includes("def ratio"));
});
