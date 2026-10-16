// Converts every module in a test set, with the same code the Worker uses.
//
//   ANTHROPIC_API_KEY=... npm run convert -- data/testset.json data/out [--model claude-haiku-5-5] [--only nl/] [--jobs 6]
//
// Writes <out>/<id>.mjs and <out>/<id>.json (status per function, suspected bugs, warnings, problems,
// token usage) and <out>/summary.json.

import fs from "node:fs";
import path from "node:path";
import { convert, costUsd, DEFAULT_MODEL, type ConvertRequest, type Usage } from "../src/convert.ts";

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const [testsetPath, outDir] = args;
const model = flag("--model", DEFAULT_MODEL);
const only = flag("--only", "");
const jobs = Number(flag("--jobs", "6"));
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!testsetPath || !outDir) {
  console.error("usage: npm run convert -- <testset.json> <out dir> [--model m] [--only prefix] [--jobs n]");
  process.exit(2);
}
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const system = fs.readFileSync(new URL("../prompt/system.md", import.meta.url), "utf8");

interface Module {
  id: string;
  lang: "python" | "clojure";
  filename: string;
  source: string;
  functions: ConvertRequest["functions"];
}

const modules: Module[] = JSON.parse(fs.readFileSync(testsetPath, "utf8")).modules.filter((m: Module) => m.id.startsWith(only));
const results: Record<string, unknown>[] = [];
const total: Usage = {};
let next = 0;

async function worker() {
  while (next < modules.length) {
    const m = modules[next++];
    const started = Date.now();
    try {
      const r = await convert({ language: m.lang, filename: m.filename, source: m.source, functions: m.functions }, { apiKey: apiKey!, model, system });
      const id = m.id.replace(/\//g, "__");
      if (r.module) fs.writeFileSync(path.join(outDir, `${id}.mjs`), r.module);
      const { module: _, ...meta } = r;
      const record = { id: m.id, ms: Date.now() - started, ...meta, costUsd: costUsd(model, r.usage) };
      fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(record, null, 1));
      for (const [k, v] of Object.entries(r.usage)) total[k as keyof Usage] = (total[k as keyof Usage] ?? 0) + (v ?? 0);
      results.push(record);
      console.log(`${r.problems.length ? "FAIL" : "ok  "} ${m.id} (${r.attempts} attempt${r.attempts > 1 ? "s" : ""}, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
    } catch (e) {
      results.push({ id: m.id, error: String((e as Error).message ?? e) });
      console.log(`ERR  ${m.id}: ${(e as Error).message}`);
    }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));

const times = results.map((r) => r.ms as number).filter(Boolean).sort((a, b) => a - b);
const summary = {
  model,
  promptVersion: results.find((r) => r.promptVersion)?.promptVersion,
  modules: results.length,
  clean: results.filter((r) => Array.isArray(r.problems) && !r.problems.length).length,
  errors: results.filter((r) => r.error).length,
  usage: total,
  costUsd: costUsd(model, total),
  medianSeconds: times.length ? times[times.length >> 1] / 1000 : null,
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ ...summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
