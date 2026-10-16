import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, checkModule, jsName, userMessage, type ConvertRequest } from "../src/convert.ts";

const req: ConvertRequest = {
  language: "clojure",
  filename: "dateformat.clj",
  source: "(defn convert-date [d in out] d)",
  functions: [{ name: "convert-date", ports: [{ name: "d", type: "string" }, { name: "in", type: "string" }, { name: "out", type: "string" }], outputType: "string" }],
};

test("hyphenated Clojure names become camelCase", () => {
  assert.equal(jsName("convert-date"), "convertDate");
  assert.equal(jsName("make_curve"), "make_curve");
});

test("the user message lists the exports with their port types", () => {
  assert.match(userMessage(req), /- convertDate\(d: string, in: string, out: string\) -> string/);
});

test("a correct module has no problems", () => {
  const src = 'import { formatDate } from "nodebox/platform";\nexport function convertDate(d, i, o) { return formatDate(d, o); }';
  assert.deepEqual(checkModule(req, src), []);
});

test("exports through a list and const count", () => {
  assert.deepEqual(checkModule(req, "const convertDate = (d) => d;\nexport { convertDate };"), []);
  assert.deepEqual(checkModule(req, "export const convertDate = (d) => d;"), []);
});

test("the checks name what is wrong", () => {
  assert.match(checkModule(req, "export function convertDate( {")[0], /does not parse/);
  assert.deepEqual(checkModule(req, "export function other() {}"), ["Missing export: convertDate"]);
  assert.deepEqual(checkModule(req, 'import fs from "node:fs";\nexport function convertDate() {}'), [
    'Import from "node:fs" is not allowed; only "nodebox" and "nodebox/platform".',
  ]);
  assert.deepEqual(checkModule(req, 'export function convertDate() { return require("fs"); }'), ["require() is not allowed."]);
  assert.deepEqual(checkModule(req, 'export async function convertDate() { return import("fs"); }'), ["Dynamic import() is not allowed."]);
});

test("the cache key changes with the source, the ports, the prompt and the model", async () => {
  const base = await cacheKey(req, "m", "p");
  assert.equal(await cacheKey({ ...req }, "m", "p"), base);
  assert.notEqual(await cacheKey({ ...req, source: req.source + " " }, "m", "p"), base);
  assert.notEqual(await cacheKey({ ...req, functions: [{ ...req.functions[0], ports: req.functions[0].ports.slice(1) }] }, "m", "p"), base);
  assert.notEqual(await cacheKey(req, "m", "q"), base);
  assert.notEqual(await cacheKey(req, "n", "p"), base);
});
