# NodeBox converter

Converts the Python 2 and Clojure code that NodeBox 3 documents link into JavaScript modules for NodeBox 4, with Claude (Haiku 5.5 by default). It has two parts:

- **The service** (`src/`, `prompt/`): a Cloudflare Worker with one endpoint, `POST /v1/convert`. The NodeBox 4 app calls it when a document links Python or Clojure code and the user agreed to send it (wording in `docs/privacy.md`).
- **The checker** (`check/`): runs each original in real NodeBox 3 (Jython 2.7 or Clojure) and each conversion in GraalJS over the same NodeBox 3 Java classes, on the same inputs, and compares every output value and every file written. A change to the prompt or the model goes in only when the checker's pass rate does not drop.

## Conversion rules

Conversions are faithful: a converted function does what the original does today, bugs included, so a document looks the same after conversion. When the model sees a likely bug, it reports it in `suspectedBugs` (what goes wrong, and the fix) without applying the fix; the app shows that to the user.

The prompt is `prompt/system.md`. Its first 12 hex digits of SHA-256 are the prompt version, which every response carries and the cache key includes.

## The API

```http
POST /v1/convert
content-type: application/json

{
  "language": "python",            // or "clojure"
  "filename": "voronoi.py",
  "source": "...",                 // at most 100 KB
  "functions": [                   // the functions the document's nodes call, with their ports in order
    { "name": "voronoi", "ports": [{ "name": "points", "type": "point", "range": "list" }], "outputType": "geometry" }
  ]
}
```

The response has `module` (the JavaScript), `functions` (status per function: `converted`, `partial` or `not-converted`, with notes), `suspectedBugs`, `warnings`, `problems` (what the checks still found wrong; empty when the module is usable), `model`, `promptVersion` and `cached`.

Every module is checked before it is returned: it must parse, export each requested function, and import only from `nodebox` and `nodebox/platform`. A failed check goes back to the model once, with the problems listed; a module that still fails is not returned.

The endpoint is public, so it guards against being used as a general AI service. The source must be Python or Clojure that defines the requested functions, or the request is refused before it reaches the model. The prompt treats everything in the source as code to convert, never as instructions. The module may add only a few hundred characters of comments and strings per function beyond those in the source (round 1's real conversions stay well under), it may not be far longer than the source, and the notes, bugs and warnings are clipped. A question smuggled into a file comes back, at best, as the same question in a comment. Usable results are cached in KV for 30 days by a hash of the source, the signatures, the prompt version and the model. Conversions that reach the model are rate-limited per IP. The service never logs source code.

## Working here

```sh
npm install
npm test && npm run typecheck
npm run dev                      # needs ANTHROPIC_API_KEY in .dev.vars
```

Deploying needs a KV namespace (`npx wrangler kv namespace create converter-cache`, then its id in `wrangler.jsonc`), the `ANTHROPIC_API_KEY` secret (from `op://NodeBox/NodeBox Converter/Anthropic/ANTHROPIC_API_KEY`), and a monthly spend limit on that key's workspace in the Anthropic console.

## Running the checker

The test corpus is the Node Library and code attached to the public NodeBox forum. Neither goes into this repo: it lives in the git-ignored `data/` folder on a machine that has it.

| File in `data/` | What it is |
|---|---|
| `Node Library/` | The Node Library folder (`node library 3-7.ndbx` plus its code and sample files) |
| `forum_corpus.json` | `{"files": [{"sha256", "names", "source", "text"}]}`: code attachments from the forum export |
| `forum_ports.json` | `[{"src", "links", "functions"}]`: node signatures from the forum's public `.ndbx` attachments |

Then, with JDK 21, Maven and Python 3:

```sh
npm run check:setup        # builds NodeBox 3 in .cache/, compiles the checker, makes data/fixtures
npm run check:testset      # data/testset.json: every module with generated inputs per function
npm run check:ref          # runs the originals: data/ref.json
ANTHROPIC_API_KEY=$(op read "op://NodeBox/NodeBox Converter/Anthropic/ANTHROPIC_API_KEY") npm run convert -- data/testset.json data/out
npm run check:js           # runs the conversions: data/js.json
npm run check:report       # data/report.json, and a summary with every failing function
```

`check/adapter/` is a draft of the NodeBox 4 JavaScript API (`nodebox`, `nodebox/platform`) built on the NodeBox 3 Java classes, so conversions are measured against exactly what the originals did. The prompt documents the same API. When NodeBox 4's own API settles, the prompt's API reference should be generated from its TypeScript types.

### Round 1 (2026-10-15)

93 files, $0.30. Of the 63 files the test could judge fairly, 46 gave identical output, 9 refused with a clear reason, and 8 were wrong. The round 2 changes in the prompt and checker address the causes: point types, `homeDir()`, date functions, `mapPoints`, the port list taken from the function definition, booleans compared as NodeBox 3 passes them, and the faithful-with-bug-report rule.

### Round 2 (2026-10-17)

Same 93 files, with the round 2 prompt and checker, $0.43, 24.6 s median. All 93 passed the module checks. Of the 68 fairly testable files (the two clock-dependent `time.py` files left out), 58 gave identical output, 5 refused with a clear reason (Python `eval`, NodeBox 3 internals, full font names, SVG path data) and 5 were wrong: Python 2 dict order (`group_by`), non-integer seeds in a test-only generator (`simplexnoise`), two Voronoi variants, and `pi_funcs`, where the model again claims `xrange()` rejects a float, which Jython accepts. The conversions reported 83 suspected bugs; spot checks found two false ones (the `xrange` claim).

Run `check:ref` and `check:js` on the same day: `time.py` formats today's date.
