# StaxSync

A minimal research-paper reader for the web: read, highlight, comment, draw with a stylus, tag and organise PDFs. Ink on paper, set in Ubuntu, with orange navigation and four highlight colours.

> **Status: MVP.** This version is the website reader only. It uses the example papers in [`test/`](test/) and keeps
> annotations, notes and tags in the browser. Sign-in, GitHub/Google Drive sync and the Chrome capture extension
> come later; this README grows with each part.

## Try it

Everything runs in Docker; nothing is installed on your machine. From the repository root:

```sh
./dev.sh dev
```

Then open <http://localhost:5173>. Without the helper script, the same in one line:

```sh
docker build -t staxsync-dev . && docker run --rm -it -p 5173:5173 --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/work/repo staxsync-dev
```

To read your own PDFs instead of the examples, put them in `test/` (or set `PAPERS_DIR` for the dev server).

## What works today

**Library**
- Lists every PDF in `test/` with title, first author, journal, year, page count and DOI (linked to doi.org), read from the PDF itself.
- Any number of tags per paper; add with Enter or a comma, remove with ×.
- Tag filter: click a tag to include it, again to exclude it, again to clear it. Match **All** or **Any**, plus **Untagged**. Counts follow the current filter.
- Search across titles, authors, tags, your highlights, comments and paper notes. Sort by added, opened, title, first author or year. Reading status: unread, reading, read.

**Reader**
- Continuous pages, page jump, zoom, fit width, two pages side by side, outline, find with match count, and a distraction-free Read mode.
- Tools: **Select · Highlight · Underline · Area · Note · Pen · Eraser**, with undo and redo.
- Highlights come in **red, green, blue and yellow**: pick one next to the Highlight tool, in the selection menu, or with keys `1`–`4` (with text selected, the key highlights it in that colour).
- Select text to get **Highlight · colours · Underline · Comment · Copy**. Click any annotation to comment, reply, change its colour, switch highlight/underline or delete it.
- Notes appear on the page as chat bubbles; a bubble with dots has a comment.
- **Stylus** (Apple Pencil, S Pen, Surface Pen, Wacom): a pen drag with Highlight or Underline snaps to whole words, the Pen draws pressure-sensitive ink, and fingers keep scrolling. Turn on "Fingers draw" in the ⋯ menu to draw without a stylus.
- Annotations panel (filter, search, jump to any annotation), a Markdown note per paper, and **Export Markdown**.
- Remembers where you stopped reading in each paper.
- Light and dark paper themes with a subtle grain, the Ubuntu font throughout, orange navigation buttons, no animations. Works on phones, tablets and desktops.
- The DOI shows next to the title in the reader (on wide screens) and links to doi.org.

**Keyboard**: `H` highlight, `1`–`4` red/green/blue/yellow highlight, `U` underline, `C` comment, `V` `A` `N` `P` `E` tools, `Ctrl/⌘ Z` undo, `Ctrl/⌘ Shift Z` redo, `Ctrl/⌘ F` find, `F` read mode, `S` annotations, `O` outline, `+` `−` `0` zoom, `Delete` remove the selected annotation, `Esc` close. `Ctrl/⌘ K` lists every command.

## Develop and test

| Command | What it does |
|---|---|
| `./dev.sh dev` | Dev server at http://localhost:5173 |
| `./dev.sh test` | Unit tests (Vitest) |
| `./dev.sh typecheck` | TypeScript check |
| `./dev.sh build` | Production build in `apps/web/dist` (includes the example papers) |
| `./dev.sh e2e` | Browser tests in Chromium, Firefox, WebKit, an iPad and a phone (Playwright) |
| `./dev.sh check` | All of the above |
| `./dev.sh lock` | Update `apps/web/package-lock.json` after changing `package.json` |
| `./dev.sh shell` | A shell inside the dev container |

The [`Dockerfile`](Dockerfile) builds one image with Node.js, the Playwright browsers and the project's dependencies.
`dev.sh` mounts the repository into it and runs every command as your own user.

## Layout

```
apps/web/              the website (React + Vite + pdf.js)
  src/lib/             pure logic: types, library and tag filter, geometry, history, commands, storage
  src/pdf/             pdf.js loading, metadata, text selection → PDF coordinates, annotation overlay
  src/components/      Library, Reader, annotation popover and panel, outline, command palette
  e2e/                 browser tests
test/                  example papers
Dockerfile, dev.sh     container-only development
```

## Licences of the example papers

The two papers in `test/` are open-access articles from *Nature Communications*, published under CC BY 4.0.

The Ubuntu and Ubuntu Mono fonts are bundled through Fontsource under the Ubuntu Font Licence 1.0.
