# Vendored front-end libraries

These files are checked in because `sail` must stay a single static binary with
no runtime dependencies (no Node, no npm, no CDN). They are served as-is by
`internal/webui` and are not modified.

| File | Version | License | Project |
| --- | --- | --- | --- |
| `lib/vue.global.prod.js` | 3.x (global build) | MIT | <https://github.com/vuejs/core> |
| `lib/highlight.min.js` | 11.11.1 | BSD-3-Clause | <https://github.com/highlightjs/highlight.js> |

`logo.svg` is the Sail Media mark from the original app.

Upgrading: replace the file with the upstream production build of the same name,
keep the license header in the file, and update this table. The UI only relies on
the documented global APIs (`Vue.createApp`, `hljs.highlight`,
`hljs.highlightAuto`, `hljs.getLanguage`).

Libraries intentionally **not** vendored: PDF rendering uses the browser's
built-in viewer (an `<iframe>` pointing at `/api/file`), so `pdf.js` and its
8 MB of assets are not shipped; Markdown is rendered by a small built-in
renderer in `app.js` (escaped first, no raw HTML passthrough).
