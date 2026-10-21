# Privacy wording for code conversion (draft)

Draft text for the NodeBox 4 app and the privacy policy. It is not legal advice. The facts in it were checked on 2026-10-21 (Anthropic Console settings, `wrangler.jsonc`); items marked **[legal]** are questions for whoever reviews it.

Conversion is a convenience: nobody has to use it, and a document whose code is not converted still opens. The text makes the privacy implications clear rather than promising more than the service does.

## In the app

Shown the first time a document links Python or Clojure code, before anything is sent.

> **Convert this code to JavaScript?**
>
> This document uses Python code that NodeBox 4 can't run as it is. NodeBox can convert it to JavaScript for you. This is optional.
>
> To do that, NodeBox sends the code files this document links to the NodeBox converter, an online service. Your images, data files and the rest of the document stay on your computer. The converter uses Claude, an AI model made by Anthropic, to write the JavaScript. Anthropic does not train its models on your code, but keeps it for 30 days and may review it for safety and security. Your code may be processed in any country, including the United States. The converter keeps the result for 30 days, so the same file always converts the same way.
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
> NodeBox 4 can convert the Python and Clojure code that older NodeBox documents use into JavaScript. This is optional, and it only happens after you agree in the app.
>
> *What is sent.* The text of the code files the document links, their file names, and the names and types of the nodes that use them. Nothing else from the document. Code can contain personal data, such as names in comments or file paths that include your user name; that is sent as it is.
>
> *Who handles it.* Our conversion service runs on Cloudflare. It sends the code to Anthropic's Claude API, which writes the conversion. Anthropic handles the code as our service provider under its commercial terms and does not use it to train its models. Anthropic keeps the code and the conversion for 30 days, during which it may access them for safety and security purposes, and then deletes them. Anthropic may process requests in any region, so your code may be processed outside the European Union, including in the United States. Cloudflare and Anthropic process the data under their standard data processing terms **[legal: confirm these cover this use and the transfer outside the EU]**.
>
> *What we keep.* The converted JavaScript and the notes that come with it, for 30 days, stored under a fingerprint (a hash) of your code, so the same file converts the same way. We do not keep the original code. For usage statistics, our service logs one line per conversion with the language, the size of the code and whether it came from the cache; never the code, and not your IP address. Cloudflare sees your IP address when the app connects; we use it only to limit how many conversions one computer can request per minute.
>
> *Your choice.* Converting is optional. A document whose code you don't convert still opens; its code nodes don't run until it is converted. You can turn automatic conversion off in Settings.

## Open questions for the review

- **[legal]** Is consent in the dialog the right lawful basis under the GDPR for code that may contain personal data, and is the wording specific enough?
- **[legal]** Do Anthropic's and Cloudflare's standard data processing terms cover this use, including the transfer outside the EU? Decided 2026-10-21: we rely on them and sign nothing separate.
