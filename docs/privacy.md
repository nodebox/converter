# Privacy wording for code conversion (draft)

Draft text for the NodeBox 4 app and the privacy policy. It is not legal advice and has not been reviewed. Items marked **[verify]** are facts to confirm before this ships; items marked **[legal]** are questions for whoever reviews it.

## In the app

Shown the first time a document links Python or Clojure code, before anything is sent.

> **Convert this code to JavaScript?**
>
> This document uses Python code that NodeBox 4 can't run as it is. NodeBox can convert it to JavaScript for you.
>
> To do that, NodeBox sends the code files this document links to the NodeBox converter. Your images, data files and the rest of the document stay on your computer. The converter uses Claude, an AI model made by Anthropic, to write the JavaScript. Anthropic does not use your code to train its models. **[verify]** The converter keeps the result for 30 days, so the same file always converts the same way. It does not record who sent it.
>
> Your original code stays next to the conversion, so you can switch back at any time. If the converter spots what looks like a bug in your code, it keeps your code working exactly as before and tells you what it found.
>
> [Convert] [Not now]
> ☐ Convert code in other documents without asking

"Python" becomes "Clojure" for Clojure files. The checkbox can be undone in Settings.

When a conversion reports a suspected bug, the app shows it next to the node, for example:

> **Possible bug in voronoi.py:** lists have no `copy()` method in Python 2, so this code always falls back to the simpler algorithm. NodeBox kept that behaviour so your document looks the same. To use the better algorithm, replace `cells.copy()` with `list(cells)`.

## In the privacy policy

> **Code conversion**
>
> NodeBox 4 can convert the Python and Clojure code that older NodeBox documents use into JavaScript. It only does so after you agree in the app.
>
> *What is sent.* The text of the code files the document links, their file names, and the names and types of the nodes that use them. Nothing else from the document, and nothing that identifies you.
>
> *Who handles it.* Our conversion service runs on Cloudflare. It sends the code to Anthropic's Claude API, which writes the conversion. Anthropic handles the code as our service provider and does not use it to train its models **[verify]**. Anthropic keeps API requests for a limited period before deleting them **[verify the current retention period and any exceptions, such as policy-violation review]**. Cloudflare and Anthropic are based in the United States, so your code may be processed outside the European Union **[legal: transfer basis, e.g. EU–US Data Privacy Framework or standard contractual clauses]**.
>
> *What we keep.* The converted JavaScript and the notes that come with it, for 30 days, stored under a fingerprint (a hash) of your code, so the same file converts the same way. We do not keep the original code. Cloudflare sees your IP address when the app connects; we use it only to limit how many conversions one computer can request per minute and do not store it **[verify what Cloudflare's Workers logs record, and their retention]**.
>
> *Your choice.* Converting is optional. A document whose code you don't convert still opens; its code nodes don't run until it is converted. You can turn automatic conversion off in Settings.

## Open questions for the review

- **[legal]** Code can contain personal data (names in comments, file paths with user names). Is consent in the dialog the right lawful basis under the GDPR, and is the wording specific enough?
- **[legal]** Are data processing agreements with Anthropic and Cloudflare in place for this use? Both offer standard ones **[verify]**.
- **[verify]** Whether the Anthropic organisation the key belongs to has zero data retention or the standard retention; the policy text depends on it.
- The 30-day cache is a product choice, not a requirement. Without it the policy gets simpler ("we keep nothing"), at the cost of a file possibly converting differently the second time.
