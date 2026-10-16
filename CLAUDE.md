# NodeBox converter

Converts NodeBox 3 Python 2 and Clojure code to NodeBox 4 JavaScript with Claude: a Cloudflare Worker (`src/`, `prompt/system.md`) and a checker that compares conversions with the originals in real NodeBox 3 (`check/`). See `README.md`.

## Rules

- Never commit the Node Library, forum code or anything derived from them (test sets, conversions, reports). They live in the git-ignored `data/`.
- Conversions are faithful: keep the original's behaviour, bugs included, and report likely bugs in `suspectedBugs` without fixing them.
- A prompt or model change needs a checker run on the full test set; it goes in only if the pass rate does not drop. Note the numbers in the commit message.
- The service never logs source code.
- No AI attribution in commits.

## Working here

- Commit straight to `main` and push.
- Verify: `npm test && npm run typecheck`.
- Deploying is manual (`npm run deploy`) and only after Frederik says so.
