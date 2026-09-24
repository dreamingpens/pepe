# Pepe

A quiet desktop library for reading and understanding research papers. All seven items in [plan.md](plan.md) are implemented, with the accepted paper-only reading layout preserved.

## Run

Requires Node.js 24+, macOS, and the [Codex CLI](https://developers.openai.com/codex/cli/) for AI features.

```sh
npm install
npm run build
npm start
```

For development, use `npm run dev`. The browser preview (`npm run dev:web`) supports PDF reading; the desktop app provides the library, native shortcuts, and Codex connection.

The app starts on your library dashboard. Open a local PDF, drop one into the window, add a direct PDF URL/arXiv ID, or use **Discover** to search arXiv by title, author, or keywords. The bundled sample is available from an empty library.

## Reading and the assistant

| Action                                           | Interaction                                                    |
| ------------------------------------------------ | -------------------------------------------------------------- |
| Reading controls                                 | Click the paper tab, or **⌘⇧L**                                |
| Open a local PDF                                 | **⌘O**, drag and drop, or **Open a paper**                     |
| Toggle assistant                                 | **⌘L**                                                         |
| Ask about a passage                              | Select PDF text, then **⌘L**                                   |
| Return to reading                                | **Esc** or the same panel shortcut                             |
| Follow an answer’s source                        | Click its page link; the source line is highlighted            |
| Follow a citation                                | Click a citation in the PDF, or a reference in the Paper panel |
| Explain a figure/equation                        | Click its region; use right-click anywhere for unusual layouts |
| Change paper size                                | **⌘+**, **⌘−**, **⌘0**, or the Paper panel                     |
| Return to the dashboard                         | **⌘⇧H**, or **Home · Your library** at the top of the Paper tab |
| Save a temporary paper                          | Open the Paper panel                                           |
| Move / close / quit                              | Drag the top strip / **⌘W** / **⌘Q**                           |

Use Ctrl instead of ⌘ on other platforms; macOS is the tested platform.

**Settings** connects to Codex using its official app-server protocol. Existing ChatGPT subscription authentication is reused. Otherwise, **Sign in with ChatGPT** opens the official browser OAuth flow. Pepe never reads or copies access tokens. An authenticated API-key Codex installation also works, using that installation’s billing.

GPT-6 Astra is the default. Available models and thinking levels come from your account’s model catalog. Fast mode, answer length, thinking level, and summary format are configurable. Fast mode uses additional subscription capacity. Answers stream into the panel; **Stop** interrupts them. **History** searches this paper’s conversations, reopens a conversation, or continues its messages in a new chat. Conversations and answers survive restarts; unsent drafts survive folding the panel during the current reading session.

Paper text is indexed with page/line locations. Visual questions additionally send a rendered image of the complete page, preserving diagrams, tables, and mathematical notation that text extraction can lose. Answer references are checked against the indexed paper before becoming clickable.

## Library and summaries

The default library is `~/Documents/Pepe`. Choose another root folder from the dashboard. Select a folder and click **+** to create a subfolder, or choose a different **Parent folder** in the dialog. Enter a path such as `AI/Transformers/Attention` to create several levels at once. The folder tree can be expanded and collapsed; renaming a folder keeps its papers and subfolders together. Move saved papers to any level and remove empty folders. Existing PDFs inside the root are discovered on startup or **Refresh library**. Local search includes titles, authors, filenames, and indexed paper text.

Citation popups offer **Open**, **Download**, and **Summarize** for one automatically matched paper. Embedded arXiv IDs, DOIs, and publisher links take priority. Otherwise arXiv, Semantic Scholar, Crossref, and OpenAlex are searched concurrently with a seven-second overall deadline; titles and authors are checked before a result is accepted. Successful PDF matches are cached across app restarts. Grouped citations show one reference at a time with previous/next controls. Uncertain matches show a retry action instead of unrelated candidates. Open uses a temporary cache without adding a PDF to your library. Download saves to the automatically managed `citations` folder and records which paper cited it. A temporarily opened citation can be saved later from the Paper panel. A direct PDF URL can still be supplied when no downloadable match is found.

Downloaded papers are indexed and summarized in the background. Reading and downloads do not wait for the AI summary. Select a paper on the dashboard to see its cached quick summary; choose **Bullets** or **Paragraph**. Bullets form a compact outline: short topic labels, individual ideas underneath, and a third level for supporting details when useful. **Regenerate summary** updates an existing summary using the current instructions and settings, keeping the previous version visible until the replacement is ready. Automatic summaries can be turned off. Summaries and page images are invalidated when a refreshed file changes.

While reading, open the **Paper** tab to see **Bullet summary** below the paper title. It reuses the saved bullet outline independently of the dashboard's format setting. Generate or regenerate it there, collapse it to reach the reading controls, or click a page reference to return to that passage in the PDF.

Drag the summary panel's left edge to change its width. In narrow windows the summary sits below the paper list; drag its bottom edge to change its height. The size is remembered. The handle also supports arrow keys, and double-clicking resets the size.

PDFs live in the chosen library. The manifest, conversations, temporary PDFs, indexes, and page images live in `~/Library/Application Support/Pepe` on macOS. Codex manages its own authentication and thread storage. Paper text, selected passages, conversation context, and requested page images are sent to Codex for answers and summaries. PDF reading and existing library content work offline; AI and online discovery require connectivity.

## Implementation and limits

Electron hosts a sandboxed renderer with a narrow IPC interface. React/TypeScript handles the interface, PDF.js renders selectable pages, and a worker thread builds indexes and full-page images. Only nearby PDF pages are mounted/rendered. PDF.js, Markdown, and math formatting load on demand; the initial application JavaScript is about 266 kB before compression. Fonts and PDF rendering assets are bundled locally.

A Rust backend was unnecessary for the measured workload: the ten-paper corpus contains 273 pages and indexes each paper in roughly 0.15–1.1 seconds on this machine. Measurements are in [artifacts/corpus-report.json](artifacts/corpus-report.json); long-document rendering measurements are in [artifacts/reader-performance.json](artifacts/reader-performance.json).

PDF layouts vary. Numbered, author/year, alphanumeric bibliography labels, ranges, and PDF citation destinations are supported, but citation/visual-region detection is heuristic. The reference list, direct PDF link field, selected-passage context, and right-click page explanation provide fallbacks. Scanned PDFs remain visually readable and explainable, but have no text OCR/indexed line references. Encrypted PDFs require an unlocked copy. Downloads are limited to 100 MB and public HTTPS sources. Paywalled or unavailable papers may have no downloadable match.

For long papers, AI context is capped and ranked by question, selected page, and abstract; the prompt explicitly states how many pages are included. Whole-page vision preserves visual content, rather than claiming lossless conversion of arbitrary figures or formulas into structured math. Summaries and explanations can still contain model errors.

## Verification

```sh
npm run check
npm test                  # Backend regression tests, build, desktop + browser tests
npm run test:corpus       # Downloads/indexes ten real arXiv papers; keeps a local ignored cache
npm run test:live         # Uses the connected Codex account for three live AI checks
```

Install Playwright’s browser once with `npx playwright install chromium`. The long-document desktop benchmark uses the corpus cache and runs after `npm run test:corpus`.

Automated tests cover storage and folder safety, concurrent citation downloads, source validation, Codex streaming/resume/cancellation/failure paths, summary caching, restart persistence, native shortcuts, PDF selection, citation/formula clicks, and render virtualization. Routine AI tests use a local protocol fixture and incur no model usage. [Live validation](artifacts/live-validation.json) separately confirms real Astra answers, multi-turn page-image explanations, and fast-mode summaries. Screenshots are written to `artifacts/`.

For isolated development/tests, `PEPE_DATA_DIR` and `PEPE_LIBRARY_DIR` override storage locations; `PEPE_CODEX_BIN` selects a Codex executable.

## Sample and licenses

The unmodified sample is [Attention Is All You Need, Vaswani et al. (2017), arXiv v5](https://arxiv.org/abs/1706.03762v5). Corpus PDFs are fetched from their original arXiv URLs, recorded in the corpus report, and excluded from Git. The papers remain the work of their authors.

PDF.js is provided by the Mozilla Foundation under Apache-2.0; text-layer positioning styles are adapted in `src/pdf-text-layer.css`. See [the PDF.js license](LICENSES/pdfjs.txt). Dependency licenses remain in their distributed packages.
