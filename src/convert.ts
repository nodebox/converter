// Converts one NodeBox 3 code library (Python 2 or Clojure) to a NodeBox 4 JavaScript module with Claude.
// Shared by the Worker (src/app.ts) and the batch script (scripts/convert.ts); it only needs fetch and
// crypto.subtle, so it runs in both.

import { parse } from "acorn";

export type Language = "python" | "clojure";

/** A port of a node that calls the function, in port order. */
export interface Port {
  name: string;
  type?: string;
  range?: string;
}

/** A function the document's nodes call, with the ports they pass to it. */
export interface Signature {
  name: string;
  ports: Port[];
  outputType?: string;
  outputRange?: string;
}

export interface ConvertRequest {
  language: Language;
  filename: string;
  source: string;
  functions: Signature[];
}

export interface FunctionStatus {
  name: string;
  status: "converted" | "partial" | "not-converted";
  notes: string;
}

export interface SuspectedBug {
  function: string;
  description: string;
  fix: string;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ConvertResult {
  module: string;
  functions: FunctionStatus[];
  suspectedBugs: SuspectedBug[];
  warnings: string[];
  /** What the checks still found wrong after the retry. Empty when the module is usable. */
  problems: string[];
  model: string;
  promptVersion: string;
  attempts: number;
  usage: Usage;
}

export interface ConvertOptions {
  apiKey: string;
  model: string;
  system: string;
  /** Overrides the API endpoint, for tests. */
  apiUrl?: string;
}

export const DEFAULT_MODEL = "claude-haiku-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const ALLOWED_IMPORTS = new Set(["nodebox", "nodebox/platform"]);

export const SCHEMA = {
  type: "object",
  properties: {
    module: { type: "string", description: "The complete JavaScript module source." },
    functions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          status: { type: "string", enum: ["converted", "partial", "not-converted"] },
          notes: { type: "string" },
        },
        required: ["name", "status", "notes"],
        additionalProperties: false,
      },
    },
    suspectedBugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          function: { type: "string" },
          description: { type: "string", description: "What goes wrong, for the document's author." },
          fix: { type: "string", description: "The change that would fix it. Not applied." },
        },
        required: ["function", "description", "fix"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["module", "functions", "suspectedBugs", "warnings"],
  additionalProperties: false,
};

/** The name a function is exported under: hyphenated Clojure names become camelCase. */
export function jsName(name: string): string {
  return name.includes("-") ? name.replace(/[-_]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase()) : name;
}

function describePort(p: Port): string {
  const t = p.type || "value";
  return `${p.name}: ${p.range === "list" ? `list of ${t}` : t}`;
}

export function userMessage(req: ConvertRequest): string {
  const lang = req.language === "python" ? "Python 2 (Jython 2.7)" : "Clojure";
  const fence = req.language === "python" ? "python" : "clojure";
  const fns = req.functions.length
    ? req.functions
        .map((f) => {
          const out = f.outputType ? ` -> ${f.outputRange === "list" ? `list of ${f.outputType}` : f.outputType}` : "";
          return `- ${jsName(f.name)}(${f.ports.map(describePort).join(", ")})${out}`;
        })
        .join("\n")
    : "- every top-level function, under its own name (camelCase for hyphenated Clojure names)";
  return `Language: ${lang}\nFile: ${req.filename}\n\nFunctions to export:\n${fns}\n\nSource:\n\`\`\`${fence}\n${req.source}\n\`\`\``;
}

type Node = { type: string; [key: string]: unknown };

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
  } else if (node && typeof node === "object" && typeof (node as Node).type === "string") {
    visit(node as Node);
    for (const [key, value] of Object.entries(node)) {
      if (key !== "type" && value && typeof value === "object") walk(value, visit);
    }
  }
}

function exportedNames(ast: Node): Set<string> {
  const names = new Set<string>();
  for (const stmt of ast.body as Node[]) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    const decl = stmt.declaration as Node | null;
    if (decl?.type === "FunctionDeclaration") names.add((decl.id as { name: string }).name);
    if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations as Node[]) {
        const id = d.id as Node;
        if (id.type === "Identifier") names.add(id.name as string);
      }
    }
    for (const s of (stmt.specifiers as Node[]) || []) {
      const exported = s.exported as Node;
      names.add((exported.name ?? exported.value) as string);
    }
  }
  return names;
}

// ---- Keeping the service a converter ----
// The endpoint is public, so someone could send a "source" that is really a question and read the answer
// out of the conversion. The checks below make that useless: the source must be code that defines the
// requested functions, and the response can carry little text the source did not already contain. Text
// lives in comments and string literals, so those are measured on both sides.

/** Characters inside comments and string literals of Python or Clojure source. A tokenizer, not a parser. */
export function sourceProse(source: string, language: Language): number {
  const re =
    language === "python"
      ? /#[^\n]*|[rRuUbB]{0,2}("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g
      : /;[^\n]*|"(?:[^"\\]|\\.)*"/g;
  let n = 0;
  for (const m of source.matchAll(re)) n += m[0].length;
  return n;
}

/** Characters inside comments, string literals and template text of a JavaScript module. */
export function moduleProse(source: string): number {
  let n = 0;
  const ast = parse(source, { sourceType: "module", ecmaVersion: "latest", onComment: (_block, text) => (n += text.length) }) as unknown as Node;
  walk(ast, (node) => {
    if (node.type === "Literal" && typeof node.value === "string") n += (node.value as string).length;
    if (node.type === "TemplateElement") n += ((node.value as { cooked?: string }).cooked ?? "").length;
  });
  return n;
}

/** Text the conversion may add beyond what the source had: notes on what changed, per function. */
export function proseAllowance(req: ConvertRequest): number {
  return 600 + 300 * req.functions.length;
}

/** The source must be code that defines every requested function, or at least one function when none are named. */
export function checkSource(req: ConvertRequest): string | null {
  const anyDef = req.language === "python" ? /^[ \t]*def\s+\w+\s*\(/m : /\(defn-?\s+\S+/;
  if (!anyDef.test(req.source)) return "The source defines no functions.";
  for (const f of req.functions) {
    const name = f.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const defined =
      req.language === "python"
        ? new RegExp(`^[ \\t]*def\\s+${name}\\s*\\(`, "m").test(req.source)
        : new RegExp(`\\(defn-?\\s+${name}[\\s\\[(]`).test(req.source);
    if (!defined) return `The source does not define ${f.name}.`;
  }
  return null;
}

/** What is wrong with a converted module, as messages the model can act on. Empty when it is usable. */
export function checkModule(req: ConvertRequest, source: string): string[] {
  let ast: Node;
  try {
    ast = parse(source, { sourceType: "module", ecmaVersion: "latest" }) as unknown as Node;
  } catch (e) {
    return [`The module does not parse: ${(e as Error).message}`];
  }
  const problems: string[] = [];
  const exported = exportedNames(ast);
  for (const f of req.functions) {
    if (!exported.has(jsName(f.name))) problems.push(`Missing export: ${jsName(f.name)}`);
  }
  walk(ast, (n) => {
    if (n.type === "ImportDeclaration" || n.type === "ExportAllDeclaration" || (n.type === "ExportNamedDeclaration" && n.source)) {
      const spec = (n.source as { value: string }).value;
      if (!ALLOWED_IMPORTS.has(spec)) problems.push(`Import from "${spec}" is not allowed; only "nodebox" and "nodebox/platform".`);
    }
    if (n.type === "ImportExpression") problems.push("Dynamic import() is not allowed.");
    if (n.type === "CallExpression" && (n.callee as Node).type === "Identifier" && (n.callee as Node).name === "require") {
      problems.push("require() is not allowed.");
    }
  });
  if (!problems.length) {
    const added = moduleProse(source) - sourceProse(req.source, req.language);
    if (added > proseAllowance(req)) {
      problems.push(`The module adds ${added} characters of comments and strings that are not in the source. Keep the original's comments and strings, and keep new comments to a short line where the code changed.`);
    }
    if (source.length > 16 * req.source.length + 4000) problems.push("The module is far longer than the source. Convert the code as it is, without adding to it.");
  }
  return [...new Set(problems)];
}

const clip = (text: unknown, max: number) => {
  const s = typeof text === "string" ? text : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Bounds the free-text fields, which are the other place a conversion could carry unrelated text. */
export function clipText(r: Pick<ConvertResult, "functions" | "suspectedBugs" | "warnings">, req: ConvertRequest) {
  const names = new Set(req.functions.map((f) => jsName(f.name)));
  return {
    functions: (r.functions ?? []).slice(0, Math.max(req.functions.length, 50)).map((f) => ({ name: clip(f.name, 100), status: f.status, notes: clip(f.notes, 400) })),
    suspectedBugs: (r.suspectedBugs ?? []).slice(0, 2 * Math.max(names.size, 3)).map((b) => ({ function: clip(b.function, 100), description: clip(b.description, 500), fix: clip(b.fix, 300) })),
    warnings: (r.warnings ?? []).slice(0, 5).map((w) => clip(w, 400)),
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identifies the prompt, so every conversion records which prompt made it and a prompt change misses the cache. */
export async function promptVersion(system: string): Promise<string> {
  return (await sha256(system)).slice(0, 12);
}

/** The same source, signatures, prompt and model always give the same key. */
export async function cacheKey(req: ConvertRequest, model: string, version: string): Promise<string> {
  const fns = req.functions.map((f) => ({ name: f.name, ports: f.ports.map((p) => [p.name, p.type ?? "", p.range ?? ""]), out: [f.outputType ?? "", f.outputRange ?? ""] }));
  return `v1/${model}/${version}/${await sha256(JSON.stringify([req.language, req.filename, req.source, fns]))}`;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Message = { role: "user" | "assistant"; content: string };

async function callApi(opts: ConvertOptions, messages: Message[]): Promise<{ content?: { type: string; text?: string }[]; stop_reason?: string; usage?: Usage }> {
  const body = {
    model: opts.model,
    max_tokens: 32000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(opts.apiUrl ?? API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new ApiError(res.status, `Claude API ${res.status}: ${text.slice(0, 300)}`);
  }
}

function addUsage(total: Usage, u: Usage): void {
  for (const k of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const) {
    total[k] = (total[k] ?? 0) + (u[k] ?? 0);
  }
}

/**
 * Converts one file. Runs the checks on the result and, when they find problems, asks once more with the
 * problems listed. The result's `problems` is empty when the module parses, exports every requested
 * function and imports only from NodeBox.
 */
export async function convert(req: ConvertRequest, opts: ConvertOptions): Promise<ConvertResult> {
  const usage: Usage = {};
  const messages: Message[] = [{ role: "user", content: userMessage(req) }];
  let parsed: Partial<ConvertResult> | undefined;
  let problems: string[] = [];
  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    const res = await callApi(opts, messages);
    addUsage(usage, res.usage ?? {});
    const text = (res.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    try {
      parsed = JSON.parse(text);
      problems = typeof parsed?.module === "string" ? checkModule(req, parsed.module) : ["The response has no module."];
    } catch (e) {
      problems = [`The response was not valid JSON: ${(e as Error).message}`];
    }
    if (res.stop_reason !== "end_turn") problems.push(`The response stopped early (${res.stop_reason}).`);
    if (!problems.length) break;
    messages.push(
      { role: "assistant", content: text },
      { role: "user", content: `The module has these problems. Return the corrected JSON.\n\n${problems.map((p) => `- ${p}`).join("\n")}` },
    );
  }
  return {
    // A module that fails the checks is not returned: it may not be a conversion at all.
    module: problems.length ? "" : (parsed?.module ?? ""),
    ...clipText({ functions: parsed?.functions ?? [], suspectedBugs: parsed?.suspectedBugs ?? [], warnings: parsed?.warnings ?? [] }, req),
    problems,
    model: opts.model,
    promptVersion: await promptVersion(opts.system),
    attempts,
    usage,
  };
}

/** USD per million tokens (input, output). Cache writes cost 1.25x input, cache reads 0.1x. */
const PRICES: Record<string, [number, number]> = { "claude-haiku-5-5": [0.1, 0.5] };

export function costUsd(model: string, u: Usage): number {
  const [inp, out] = PRICES[model] ?? [NaN, NaN];
  return ((u.input_tokens ?? 0) * inp + (u.cache_creation_input_tokens ?? 0) * inp * 1.25 + (u.cache_read_input_tokens ?? 0) * inp * 0.1 + (u.output_tokens ?? 0) * out) / 1e6;
}
