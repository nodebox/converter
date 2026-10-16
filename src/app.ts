// The conversion service: POST /v1/convert takes one code library and returns its JavaScript conversion.
// The NodeBox app calls it when a document links Python or Clojure code, after the user agreed to send it.

import { ApiError, cacheKey, convert, DEFAULT_MODEL, promptVersion, type ConvertRequest, type ConvertResult, type Signature } from "./convert.ts";

export interface Env {
  ANTHROPIC_API_KEY: string;
  /** Overrides DEFAULT_MODEL. */
  MODEL?: string;
  /** Finished conversions by cacheKey(), kept CACHE_DAYS. */
  CACHE: KVNamespace;
  /** Per client IP. */
  RATE_LIMITER: RateLimit;
}

/** Larger files are not code someone wrote by hand. The largest Node Library file is about 20 KB. */
export const MAX_SOURCE_BYTES = 100_000;
const MAX_FUNCTIONS = 100;
export const CACHE_DAYS = 30;

type Response200 = Omit<ConvertResult, "usage" | "attempts"> & { cached: boolean };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

/** The request body, or a message saying what is wrong with it. */
export function readRequest(body: unknown): ConvertRequest | string {
  if (!body || typeof body !== "object") return "The body must be a JSON object.";
  const b = body as Record<string, unknown>;
  if (b.language !== "python" && b.language !== "clojure") return 'language must be "python" or "clojure".';
  if (typeof b.filename !== "string" || !b.filename || b.filename.length > 200) return "filename must be a file name.";
  if (typeof b.source !== "string" || !b.source.trim()) return "source must be the file's text.";
  if (new TextEncoder().encode(b.source).length > MAX_SOURCE_BYTES) return `source is larger than ${MAX_SOURCE_BYTES} bytes.`;
  if (!Array.isArray(b.functions) || b.functions.length > MAX_FUNCTIONS) return `functions must be a list of at most ${MAX_FUNCTIONS}.`;
  const functions: Signature[] = [];
  for (const f of b.functions) {
    if (!f || typeof f.name !== "string" || !/^[A-Za-z_][\w\-?!*]*$/.test(f.name) || !Array.isArray(f.ports)) {
      return "Each function needs a name and a list of ports.";
    }
    const ports = f.ports.map((p: Record<string, unknown>) => ({ name: String(p?.name ?? ""), type: p?.type ? String(p.type) : undefined, range: p?.range ? String(p.range) : undefined }));
    functions.push({ name: f.name, ports, outputType: f.outputType ? String(f.outputType) : undefined, outputRange: f.outputRange ? String(f.outputRange) : undefined });
  }
  return { language: b.language, filename: b.filename, source: b.source, functions };
}

export async function handle(request: Request, env: Env, system: string): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") {
    return new Response("NodeBox code converter. POST /v1/convert\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (url.pathname !== "/v1/convert") return error(404, "Not found.");
  if (request.method !== "POST") return error(405, "Use POST.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "The body is not JSON.");
  }
  const req = readRequest(body);
  if (typeof req === "string") return error(400, req);

  const model = env.MODEL || DEFAULT_MODEL;
  const version = await promptVersion(system);
  const key = await cacheKey(req, model, version);
  const hit = await env.CACHE.get<Response200>(key, "json");
  if (hit) return json({ ...hit, cached: true });

  // Only conversions that reach the model count against the limit, so reopening a document stays free.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.RATE_LIMITER.limit({ key: ip });
  if (!success) return error(429, "Too many conversions. Try again in a minute.");

  let result: ConvertResult;
  try {
    result = await convert(req, { apiKey: env.ANTHROPIC_API_KEY, model, system });
  } catch (e) {
    // The source is never logged: it is the user's code.
    console.error(JSON.stringify({ event: "convert-failed", status: e instanceof ApiError ? e.status : null, bytes: req.source.length }));
    return error(502, "The conversion service is unavailable. Try again later.");
  }
  const { usage, attempts, ...rest } = result;
  console.log(JSON.stringify({ event: "converted", language: req.language, bytes: req.source.length, attempts, problems: result.problems.length, usage }));
  const out: Response200 = { ...rest, cached: false };
  if (!result.problems.length) {
    await env.CACHE.put(key, JSON.stringify(out), { expirationTtl: CACHE_DAYS * 86400 });
  }
  return json(out);
}
