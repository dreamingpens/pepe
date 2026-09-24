# Pepe

A quiet desktop paper reader. This is the **item 1 UI/UX review** from [plan.md](plan.md).

The reading view contains one paper tab and the PDF itself. No toolbar, sidebar, page counter, floating actions, or hover controls appear while reading. Clicking the paper tab reveals reading controls; closing the panel returns to the paper.

## Run the desktop app

Requires Node.js 24 or newer. Dependencies and the sample paper are included in the current workspace setup.

```sh
npm install
npm run dev
```

To run the built app without a development server:

```sh
npm run build
npm start
```

The built app reads PDFs locally and works offline. Files are never uploaded. Reading appearance is saved locally; the current PDF, selected passage, and chat draft remain in memory for this session. The sample opens again on restart.

## Try the interface

| Action                           | Interaction                                                    |
| -------------------------------- | -------------------------------------------------------------- |
| Reading controls                 | Click the paper tab, or **⌘⇧L**                                |
| Open a PDF                       | **⌘O**, drop a PDF into the window, or use the reading panel   |
| Assistant preview                | **⌘L** to unfold or fold the right panel                       |
| Bring a passage into the preview | Select text in the PDF, then **⌘L**                            |
| Return to reading                | **Esc**, the panel’s close button, or the same toggle shortcut |
| Change paper size                | **⌘+**, **⌘−**, **⌘0**, or the reading panel                   |
| Navigate                         | Scroll, use the page field, or choose a section in Contents    |
| Full screen                      | **⌃⌘F** on macOS (also in the native View menu)                |
| Move / close window              | Drag the empty top strip / **⌘W**; **⌘Q** quits                |

On Windows and Linux, use Ctrl in place of ⌘. macOS is the platform verified for this review.

The panel borrows the understated header and composer from the supplied chat screenshots. It supports selected passages and an editable draft so the interaction can be reviewed. **AI is not connected, and Send is disabled.** The draft survives folding the panel, and opening a new PDF clears the previous paper’s draft and selection.

Items 2–6 remain for later: backend/performance work, AI/OAuth/model controls, answers and reference navigation, citation downloads, the library/dashboard, and automatic summaries. There is no account setup or external service in this pass.

## Verify

```sh
npx playwright install chromium
npm test
```

Six end-to-end tests cover the built Electron app, native and DOM shortcuts, file opening, paper-only mode, panel navigation, reading-position preservation, selectable text, draft retention, invalid files, keyboard focus, smaller windows, and local appearance preferences. Review screenshots are written to `artifacts/`.

`npm run dev:web` also provides a browser preview at <http://127.0.0.1:5173>. Browsers may reserve ⌘L and ⌘O, so use the paper tab to reach the controls and Assistant there; the desktop app supports both shortcuts directly.

## Implementation and sample

React + TypeScript handle the interface, PDF.js renders the paper with selectable text, and Electron provides the desktop window and shortcuts. The sandboxed renderer has no Node.js or filesystem API access. Its preload bridge only receives a fixed set of reader commands. PDF rendering assets and fonts are bundled locally.

The unmodified sample is [Attention Is All You Need, Vaswani et al. (2017), arXiv v5](https://arxiv.org/abs/1706.03762v5), downloaded from [arXiv](https://arxiv.org/pdf/1706.03762v5) for this local reading review. The paper remains the work of its authors.

PDF.js is provided by the Mozilla Foundation under Apache-2.0; its text-layer positioning styles are adapted in `src/pdf-text-layer.css`. See [the PDF.js license](LICENSES/pdfjs.txt).
