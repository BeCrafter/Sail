# Vendored front-end libraries

These files are checked in because `sail` must stay a single static binary with
no runtime dependencies (no Node, no npm, no CDN). They are served as-is by
`internal/webui` except for the PDF.js viewer hook noted at the end of this file.

| File | Version | License | Project |
| --- | --- | --- | --- |
| `lib/vue.global.prod.js` | 3.x (global build) | MIT | <https://github.com/vuejs/core> |
| `lib/highlight.min.js` | 11.11.1 | BSD-3-Clause | <https://github.com/highlightjs/highlight.js> |
| `lib/jszip.min.js` | 3.10.1 | MIT | <https://github.com/Stuk/jszip> |
| `lib/docx-preview.min.js` | 0.4.0 | Apache-2.0 | <https://github.com/VolodymyrBaydalka/docxjs> |
| `lib/exceljs.min.js` | 4.4.0 | MIT | <https://github.com/exceljs/exceljs> |
| `lib/pptx-preview.bundle.js` | 1.0.7 | MIT | <https://github.com/mescius/pptx-preview> |
| `lib/echarts.min.js` | 6.x | Apache-2.0 | <https://github.com/apache/echarts> |
| `lib/three.bundle.min.js` | 0.185.0 (core + loaders) | MIT | <https://github.com/mrdoob/three.js> |
| `lib/pako.min.js` | 2.1.0 | MIT AND Zlib | <https://github.com/nodeca/pako> |
| `lib/UTIF.js` | 3.1.0 | MIT | <https://github.com/photopea/UTIF.js> |
| `lib/ag-psd.bundle.js` | 27.0.0 | MIT | <https://github.com/Agamnentzar/ag-psd> |
| `lib/heic2any.min.js` | 0.0.4 (libheif WASM) | MIT | <https://github.com/alexcorvi/heic2any> |
| `lib/pdfjs/` | 6.2.108 | Apache-2.0 | <https://github.com/mozilla/pdf.js> |

`lib/preview_xlsx.js`, `lib/preview_xlsx_images.js` and `lib/preview_docx_fonts.js`
are Sail's own xlsx grid / OOXML image / DOCX CJK-font helpers (ported from the
Vanor reference app); they are plain ES modules with no third-party imports.

`logo.svg` is the Sail Media mark from the original app.

Upgrading: replace the file with the upstream production build of the same name,
keep the license header in the file, and update this table. The core UI only
relies on the documented global APIs (`Vue.createApp`, `hljs.highlight`,
`hljs.highlightAuto`, `hljs.getLanguage`); the lazy preview modules use the
globals listed above (`docx`, `ExcelJS`, `JSZip`, `pptxPreview`, `echarts`,
`pako`, `UTIF`, `agPsd`, `heic2any`) and the `three` ES module.

The Office/3D/decoder libraries above are **lazy-loaded** by `app.js` the first
time a matching file is opened (`loadLib` / `loadModule`), so the initial page
still ships only Vue, highlight.js and the app itself.

PDF rendering uses the vendored PDF.js viewer (`lib/pdfjs/web/viewer.html`) so
the preview matches the Vanor app's page layout, search and selection behavior.
`web/sail-pdf-theme.js` and `web/sail-pdf.css` are Sail's small theme/chrome
adapters; the upstream viewer/build files are otherwise unmodified. Markdown is
rendered by a small built-in renderer in `app.js` (escaped first, no raw HTML
passthrough).
