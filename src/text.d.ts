// Wrangler bundles .md files as text (the "rules" in wrangler.jsonc).
declare module "*.md" {
  const text: string;
  export default text;
}
