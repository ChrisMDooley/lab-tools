# DMD Lab Platform

Browser tools for this lab's transfection and qPCR work. No install, no server, no network.

| Page | What it does |
|---|---|
| `index.html` | **Transfection planner** - experiment setup, plate designer, dilution arithmetic, master mixes derived from the layout |
| `qpcr.html` | **qPCR analysis** - reads QuantStudio `.eds` files, relative quantification, reference-gene QC, figures |

Open either file in **Chrome or Edge**. Serving the folder (GitHub Pages, or any static share)
also works and enables a few extras.

---

## qPCR analysis

Drop `.eds` files on the page. They are parsed **in the browser** - a `.eds` is a ZIP of JSON,
read with the platform's own `DecompressionStream`, so there is no library and nothing is
uploaded anywhere. A 336-well plate parses in well under a second.

What it does:

- Relative quantification by the **Livak method**, reference gene and calibrator selectable
- **Geometric** mean of biological replicates with +/-1 SE in log space - a ratio's natural
  centre is geometric, which is also why the calibrator lands on exactly 1.000
- **Reference-gene stability** chart, because every ratio is only as good as the gene it is
  divided by
- Every excluded reaction listed with its reason. Nothing is dropped silently
- Export CSV, SVG and PNG

**The cqConf floor matters.** On an October 2026 plate a well flagged `AMP` carried a plausible
Cq of 23.51 against 29.3-30.2 for its siblings, with a confidence of **0.031**. Because the
instrument calibrates on that sample it had crushed an entire panel. The default floor is 0.5.

**One trap worth knowing:** the instrument writes bare `NaN` into its JSON, which is not valid
JSON. Python tolerates it, `JSON.parse` does not. `eds.js` sanitises it where a value is
expected, without corrupting a sample name that happens to contain those letters.

### Validation

The Validation panel runs assertions against the calculation core, which is DOM-free and so can
be checked independently.

It can also run **parity checks against an analysis you already trust**: put expected values in
`validation.json` (gitignored - see `validation.example.json` for the format) and they are
asserted whenever the matching plate and settings are loaded. Expected values name real samples
and carry results, so they stay out of the repository for the same reason sequences do.

### Browser requirement

`DecompressionStream` is needed to read `.eds`, and the planner's folder mode (when built) needs
the File System Access API, which **Firefox and Safari do not support**. Chrome or Edge.

---

## Sequences are not in this repository

**`oligos.json` is deliberately absent and is listed in `.gitignore`.**

Real ASO sequences are kept out of the application file so the tool can be shared or published
without publishing them. Unfiled sequences in a public repository are a timestamped disclosure
and cannot be withdrawn — deleting a repo does not undo forks, mirrors or archives.

The planner works perfectly well without a library. Sequences are reference data; **no
calculation uses them.**

To load yours:

- **Opened as a file** — click *Load library* on the ASO & Gapmer Setup page, or drag
  `oligos.json` onto the drop zone. It is then kept in that browser only.
- **Served over http(s)** — put `oligos.json` next to `index.html` and it loads automatically.
  Do not do this on a public host.

`oligos.example.json` shows the format, with fictional sequences:

```json
[
  { "name": "Oligo_A", "label": "exon N, 3' acceptor", "chemistry": "exon-skipping",
    "stockConc": 400, "stockUnit": "µM", "seq": "GGTTACCTGATTACGGTA", "notes": "" }
]
```

`chemistry` is one of `steric`, `exon-skipping`, `gapmer`, `other`. It is **not** cosmetic: it
forms part of the master-mix grouping key, so a gapmer and a steric blocker at the same nominal
concentration are never pooled into one mix.

---

## What it does

| Page | |
|---|---|
| Experiment Setup | metadata, cell lines, global calculation settings, JSON save/open |
| Plate Designer | click, drag, shift-click, row/column fill, copy/paste, concentration series, auto-numbered replicates, five colour modes, multiple plates |
| ASO & Gapmer Setup | oligo registry and the local sequence library |
| Transfection Calculator | one condition worked through step by step |
| Master Mixes | derived from the layout, never typed |
| Vessel Formats | editable geometry and default volumes |
| Validation | 32 assertions, including parity with the source workbook |

Cell seeding, protocol generation and Excel/CSV/PDF export are Phase 3.

---

## The calculations

Built from `ASO_TransfectionHepG2_curve.xlsx`. The audit and the decisions behind every change
are in `docs/`.

**Preserved from the workbook**

- `C1V1 = C2V2` evaluated against **final culture volume**, never the mix volume. This is the
  most common place such a sheet goes wrong, and the original got it right.
- Diluent **back-calculated** from the rounded oligo volume, so tube totals stay exact and
  rounding cannot drift into the total.
- Equal-volume two-tube architecture as the default RNAiMAX protocol.

**Changed, deliberately**

- **One excess rule** for every component, default 10% + 1 well of dead volume. The workbook ran
  the ASO tube at +9.4% (wells hand-typed as 35 against a real 32) and the lipid tube at +15.2%,
  while appearing to promise 5%.
- **Minimum pipetting volume** (default 0.4 µL) with an intermediate-dilution planner. From a
  400 µM stock into 100 µL wells, one well falls below 0.4 µL for any target under 1.6 µM; a
  35-well mix holds to about 46 nM. For dose-response work this is the normal case.
- **Legacy plasmid columns dropped** — `DNA amount` (312.5 ng/cm²) and `Vol Tfec rate`
  (`=12.5/C9`). The latter is provably unusable: at 96-well it gives a 1.1 µL total mix, 0.55 µL
  per tube, when RNAiMAX alone is 0.3 µL.
- **Gymnotic uptake solved separately.** With no carrier the oligo goes straight in, so the final
  volume depends on the dose: `Vo = C·media/(Cstock − C)`. Treating it as "lipid with zero
  reagent" would silently use the wrong denominator.

**Only the 96-well row is measured.** It reproduces the workbook exactly — 90 µL media + 10 µL
mix, 0.3 µL RNAiMAX. Every other format is scaled from it at 10% mix and 0.30% v/v reagent and
is labelled *derived*. Thermo quotes 9 µL RNAiMAX for a 6-well against the 6.0 µL derived here,
so check that row before a student uses it.

Cell densities (HEK293T 52,100 and HeLa 28,906.25 cells/cm²) are carried over **unvalidated**.
HeLa's figure back-solves exactly to 9,250 cells in a 96-well, so it looks derived from a target
well count rather than measured.

---

## Validation

Open the Validation page. The calculation core has no access to the DOM, so it can be checked
independently. Parity cases reproduce the workbook's own cells: 35 wells at 2.5 µM from a 400 µM
stock gives **21.9 µL oligo, 153.1 µL Opti-MEM, 175.0 µL per tube** — cells `I20`, `K20`, `M20`.

---

## Structure

Everything is in `index.html`, in labelled modules: `UNITS`, `FORMATS`, `METHODS`, `CALC`,
`STATE`, `PLATE`, `UI`, `TESTS`. `CALC` is pure and DOM-free.

One file is a deliberate choice, not laziness: it survives being emailed, copied to a USB stick
or renamed, which a tool used by students has to do. Splitting it into modules would be more
conventional and would break that.

---

## Data handling

Work is kept in browser storage automatically, which is per-machine and can be cleared. **JSON
export is the portable copy.** `.eds`, `.edt`, `.xlsx` and experiment JSON are gitignored.
