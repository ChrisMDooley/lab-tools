# Where this stands, and how to pick it up

Last updated 16 Nov 2026. **Read this file first.** It exists so a new session
does not have to re-derive the state of the project by reading every file.

Run the tests before changing anything and again afterwards:

```
node tests/run.js      # 59 checks, no browser needed
node tests/pages.js    # drives each page's own self-test panel (needs Playwright)
```

---

## The shape of the thing

Three pages, no build step, no server, no accounts. Code is served from GitHub
Pages; **data never leaves the user's machine** — the pages read and write a
folder the user picks, through the File System Access API (Chrome/Edge only;
Firefox and Safari have both declined to implement it, and the pages say so
and fall back to import/export).

| Page | Module files it loads | What it does |
|---|---|---|
| `index.html` | vfs, bundle, workspace | transfection planning, dose/volume maths, plate layout |
| `qpcr.html` | vfs, bundle, workspace, eds, ddct, fig | reads `.eds`, ΔΔCt, QC, figures |
| `notebook.html` | vfs, bundle, workspace, md, notebook | lab-book entries with images and tables |

### Modules

| File | Role | Reachable from a page? |
|---|---|---|
| `js/vfs.js` | filesystem interface: real folder, or in-memory for tests | yes |
| `js/bundle.js` | experiment folders, manifests, locking | yes |
| `js/workspace.js` | connects pages to the chosen folder | yes |
| `js/eds.js` | reads QuantStudio `.eds` (a ZIP of JSON) | yes |
| `js/ddct.js` | ΔΔCt / Livak, QC filtering | yes |
| `js/fig.js` | SVG figures | yes |
| `js/md.js` | safe Markdown renderer | yes |
| `js/notebook.js` | notebook entries and attachments | yes |
| **`js/combine.js`** | **cross-plate pooling + the 3 new figures** | **NO — nothing loads it** |
| **`js/dax.js`** | **Design & Analysis plate setup read/write** | **NO — nothing loads it** |

**The two bolded rows are the most important thing in this file.** Both are
written, committed and tested, and neither is wired into any page. A user
cannot reach them. That is the first work to do.

---

## Decisions already taken — do not silently reopen these

1. **Files are the source of truth.** Any index or cache is derived and
   disposable. A record must be readable in ten years with no browser.
2. **One experiment, one folder**, with stages accumulating rather than
   overwriting:
   `transfection.json`, `plate.json`, `qpcr/run-N.json`, `notebook/`,
   `raw/`, `figures/`, `exports/`, `manifest.json`, `.lock.json`.
   A later qPCR run must never rewrite the transfection record it was based on.
3. **One plate = one transfection** (confirmed by the user). Folder membership
   is therefore a valid link; an "analysis" chooses which runs within a folder
   to pool.
4. **Plates are never pooled into a single ΔΔCt.** Each run is analysed with
   its own calibrator and the plate is kept as a visible factor. The
   across-plate summary is a geometric mean of per-plate ratios.
5. **Nothing is invented.** A missing seeding density, timepoint or induction
   agent is shown as missing. The time-course figure refuses to draw rather
   than infer a harvest time.
6. **No real sequences in this repo.** See the next section.

---

## The disclosure rule — check this before every push

The repo is **public**, and a second patent filing on the newly screened ASO
series has not been made. A public commit is an irreversible, timestamped
publication.

Untracked, loaded at runtime from the user's data folder, never committed:

- `oligos.json` — the ASO/gapmer transfection library (107 oligos, 21 genes)
- `primers.json` — the CDBN primer registry (1,727 entries)
- `validation.json` — expected RQ values from the October analysis

Committed `*.example.json` files show only the field shape, with invented
sequences. `.gitignore` also covers `*.eds`, `*.edt`, `*.xlsx`, `experiments/`.

Before any push:

```
git ls-files | grep -E '^(oligos|primers|validation)\.json$'     # must be empty
git diff origin/main..HEAD | grep '^+' | grep -oE '\b[ACGT]{15,}\b' | sort -u
```

The second command must return nothing but the dummy `ACGTACGTACGTACGTACGT`
in `primers.example.json`.

**Also:** `oligos.json` and `primers.json` must never sit next to
`index.html`, because that directory is what GitHub Pages serves.

---

## What to build next, in order

1. **Wire up `combine.js` and the three figures in `qpcr.html`.** Pick which
   runs in a folder to pool, then show the combined bar chart, the
   oligo × target heatmap and the time course. The code and its tests exist.
2. **Plate designer UI driving `dax.js`.** A 384-well grid; generate sample
   names from a transfection layout; export a Design & Analysis plate setup
   and import one back. `DAX.build()` already reproduces the lab's own
   convention (groups in row bands, targets in contiguous blocks, adjacent
   technical duplicates) and `parse → write` is byte-identical.
3. **`targets.json`** — the assay→primer map and the `UTNR` → `UTRN` display
   fix. Written, not wired in. The instrument spelling must not change.
4. **Phase 3 of the planner** — cell seeding, protocol generator,
   documentation worksheet, real `.xlsx` export via `CompressionStream`,
   CSV, and PDF via browser print.
5. **Cross-experiment search over qPCR data** — "every well that got ASO_95 at
   2.5 µM, with its Cq and which reference gene normalised it". The notebook
   already has its own text search; the measured data does not.
6. **Flag NMD-incompatible comparisons.** The HEK UPF1 degron line records its
   induction state but nothing warns when a depleted sample is compared
   against an NMD-competent control.

---

## Open questions for the user — do not guess these

- Seeding densities for Pv16, C2C12, iPSC-CM and the HEK UPF1 degron line.
  All four are in the app with `density: null` on purpose.
- Whether 35 mm counts as 8.8 or 9.6 cm².
- Which documentation fields the protocol sheet should carry.
- Incubation-time placeholders need confirming.
- `CDBN_1658`–`CDBN_1667`: ten DMD primers typed only `qpcr`, with no exon
  annotation. Nothing establishes what they target. Ask whoever ordered them.
- Lab-Bro (`github.com/MarcoTarasco/Lab-bro`) is a lab mate's tool under the
  **PolyForm Strict** licence, which forbids derivative works, and its repo
  contains no source anyway. Features may be reimplemented independently;
  code may not be copied. Talk to Marco before building further overlap.

---

## Things that have already bitten, so they do not bite twice

- `text-transform: uppercase` turns µ (U+00B5) into Greek capital Mu, so "µL"
  renders as "ML" — a 1000× misreading in a volume calculator. `.u { text-transform: none }`
  guards this and there is a test for it.
- `app.css` sets `input { width: 100% }`, which stretches a checkbox across a
  whole line.
- A literal `</script>` inside a JS string ends the HTML script block.
  `node --check` will not catch it; the browser silently truncates everything
  after it.
- `goto` is a reserved word; `async function goto()` under `"use strict"` is a
  parse error that kills the whole inline script.
- SVG's y-axis is inverted — use `Math.min`, not `Math.max`, to place a label
  above a bar.
- The instrument writes bare `NaN` and `Infinity` into `.eds` JSON, which
  `JSON.parse` rejects. `eds.js` sanitises only where a value is expected.
- Poppins has no Δ, μ (U+03BC), ′, ←, →, ★ or ✓. It does have µ (U+00B5).
- `load()` in `index.html` must merge new default cell lines and plate formats
  by name, or a plan saved earlier silently keeps an outdated catalogue.
