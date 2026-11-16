#!/usr/bin/env node
/* ============================================================================
   tests/run.js  -  every DOM-free check in one command:  node tests/run.js

   Why this file exists: the modules below were each tested while being
   written, with the harness pasted into a shell each time. That is slow, it
   is not repeatable, and nothing catches a regression later. Committing the
   checks means a change can be verified in one command instead of being
   re-derived from scratch.

   The browser pages have their own self-tests, shown in a panel at the
   bottom of each page, and `node tests/pages.js` drives those headlessly if
   Playwright is present.
   ========================================================================= */
"use strict";
const path = p => require("path").join(__dirname, "..", p);

global.VFS     = require(path("js/vfs.js"));
global.BUNDLE  = require(path("js/bundle.js"));
global.MD      = require(path("js/md.js"));
global.NOTEBOOK= require(path("js/notebook.js"));
global.COMBINE = require(path("js/combine.js"));
global.DAX     = require(path("js/dax.js"));

let pass = 0, fail = 0, group = "";
const G  = name => { group = name; console.log("\n" + name); };
const ok = (cond, msg) => {
  if(cond === true){ pass++; console.log("  ok    " + msg); }
  else { fail++; console.log("  FAIL  " + msg + (cond === false ? "" : "  -> " + cond)); }
};
const eq = (a, b, msg) => ok(a === b ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`, msg);

(async () => {

/* ---------------------------------------------------------------- md.js -- */
G("md.js  - rendering and the safety that matters when people paste from Word");
ok(!/<script/i.test(MD.render("<script>x<\/script>")), "a pasted script tag is inert");
ok(!/<a /.test(MD.render("[c](javascript:alert(1))")), "javascript: link is not made clickable");
ok(!/<img/.test(MD.render("![](attachments/../../etc/passwd)")), "path traversal in an image is rejected");
ok(!/<img/.test(MD.render('![x](data:image/png;base64,A" onerror="alert(1))')),
   "a url that tries to break out of the attribute produces no tag");
ok(/<img src="attachments\/g\.png"/.test(MD.render("![](attachments/g.png)")), "attachment image renders");
ok(/<strong>b<\/strong>/.test(MD.render("**b**")), "bold");
ok(/<h3>T<\/h3>/.test(MD.render("# T")), "heading");
ok(/<table>/.test(MD.render("| a | b |\n| --- | --- |\n| 1 | 2 |")), "table");
ok(/checkbox" disabled checked/.test(MD.render("- [x] done")), "checked task item");
ok(!/<em>/.test(MD.render("`a*b*c`")), "emphasis inside code is left alone");
ok(MD.tsvToTable("A\tB\n1\t2") !== null, "Excel paste becomes a table");
eq(MD.tsvToTable("prose with\ta tab"), null, "prose with a stray tab is not a table");
eq(MD.tsvToTable("a\tb\nc"), null, "ragged rows are rejected");

/* ------------------------------------------------------------ bundle.js -- */
G("bundle.js  - one experiment, one folder, stages accumulating");
{
  const v = VFS.memory(), id = "EXP-1";
  await BUNDLE.putRecord(v, id, "transfection.json",
    { kind:"transfection", meta:{ name:"dose curve" }, doses:[0.5,2.5] });
  await BUNDLE.putRecord(v, id, "plate.json", { kind:"plate", wells:[{ well:1 }] });
  const r1 = await BUNDLE.nextRun(v, id);
  eq(r1, "qpcr/run-1.json", "first qPCR run is run-1");
  await BUNDLE.putRecord(v, id, r1, { kind:"qpcr", refTarget:"hRPL10A" },
    { extras:[{ path:"raw/p1.eds", data:new Uint8Array([80,75,3,4]) }] });
  const r2 = await BUNDLE.nextRun(v, id);
  eq(r2, "qpcr/run-2.json", "a re-run is run-2, not an overwrite");
  await BUNDLE.putRecord(v, id, r2, { kind:"qpcr", refTarget:"TOP1" });

  const L = await BUNDLE.load(v, id);
  eq(L.experiment.meta.name, "dose curve", "the transfection record survives every later write");
  eq(L.qpcr.length, 2, "both runs are present");
  eq(L.qpcr[0].refTarget, "hRPL10A", "run-1 was not touched by run-2");
  ok(L.verification.ok === true, "the manifest verifies after incremental writes");
  ok(L.manifest.files.some(f => f.path === "raw/p1.eds"), "the raw .eds is checksummed");

  await v.writeFile("experiments/" + id + "/raw/p1.eds", new Uint8Array([0,0,0,0]));
  const ver = await BUNDLE.verify(v, id);
  ok(ver.ok === false && ver.changed.length === 1, "editing a raw file outside the app is detected");

  const li = (await BUNDLE.list(v))[0];
  eq(JSON.stringify(li.stages), JSON.stringify(["transfection","plate","qpcr","qpcr"]),
     "the folder lists in workflow order, not alphabetical");

  const v2 = VFS.memory();
  await BUNDLE.save(v2, { kind:"transfection", meta:{ name:"old" } }, { id:"OLD" });
  eq((await BUNDLE.load(v2, "OLD")).experiment.meta.name, "old",
     "a folder in the older single-record shape still loads");
}

/* --------------------------------------------------------- notebook.js -- */
G("notebook.js  - entries as files, images beside them");
{
  const v = VFS.memory(), id = "EXP-1";
  await BUNDLE.putRecord(v, id, "transfection.json", { kind:"transfection", meta:{ name:"x" } });
  const a = await NOTEBOOK.create(v, id, { title:"Same", author:"CD", body:"first" });
  const b = await NOTEBOOK.create(v, id, { title:"Same", author:"CD", body:"second" });
  ok(a.file !== b.file, "same title in the same second gives distinct files");
  eq((await NOTEBOOK.list(v, id)).length, 2, "neither entry overwrote the other");

  const img = await NOTEBOOK.attach(v, id, new Uint8Array([1,2,3]), "png");
  ok(img.path.startsWith("attachments/"), "the markdown path is relative to the entry");
  eq(img.storedAt, "notebook/" + img.path, "but it is stored under notebook/");
  eq(MD.safeUrl(img.path), img.path, "and the renderer accepts that path");
  const dup = await NOTEBOOK.attach(v, id, new Uint8Array([1,2,3]), "png");
  ok(dup.reused === true, "identical bytes are stored once");

  await NOTEBOOK.update(v, id, a.file, { body:"edited" });
  const back = await NOTEBOOK.read(v, id, a.file);
  eq(back.body.trim(), "edited", "the edit was written");
  ok(back.edited !== "", "an edit sets the edited stamp");
  eq(back.created, a.created, "an edit does not clobber created");
  eq((await NOTEBOOK.history(v, id, a.file)).length, 1, "the superseded text is kept");

  await NOTEBOOK.remove(v, id, b.file);
  eq((await NOTEBOOK.list(v, id)).length, 1, "the entry was deleted");
  ok((await NOTEBOOK.history(v, id, b.file)).some(h => h.includes("deleted")),
     "a deleted entry is still recoverable from .history");
  ok((await BUNDLE.verify(v, id)).ok === true, "the manifest is still honest after all of that");

  const round = NOTEBOOK.parse(NOTEBOOK.compose(
    { title:"T", author:"CD", tags:["a","b"], body:"one\n\n---\n\ntwo" }), "notebook/x.md");
  eq(round.title, "T", "frontmatter round-trips the title");
  eq(round.tags.join(), "a,b", "...and the tags");
  ok(round.body.includes("---") && round.body.includes("two"),
     "...and a body containing a horizontal rule survives");
  ok(/\d{6}$/.test(NOTEBOOK._stamp(new Date())), "entry stamps carry seconds, not just minutes");
  ok(/^[\w-]+$/.test(NOTEBOOK._slug("µL / 50% «x»")), "a title slug is filesystem-safe");
}

/* ---------------------------------------------------------- combine.js -- */
G("combine.js  - pooling plates without pretending they share a baseline");
{
  const groups = ["Control","Treated"], targets = ["DMD_myo"];
  const mk = (rq, ref, cal) => {
    const res = new Map();
    res.set("Control\u0000DMD_myo", { group:"Control", target:"DMD_myo", rq:1, lo:0.9, hi:1.1, n:3 });
    res.set("Treated\u0000DMD_myo", { group:"Treated", target:"DMD_myo", rq, lo:rq*0.9, hi:rq*1.1, n:3 });
    return { refTarget:ref||"hRPL10A", calibrator:cal||"Control", groups, targets, res };
  };
  const M = COMBINE.merge([
    { id:"r1", label:"P1", analysis:mk(0.5), timepoint:24 },
    { id:"r2", label:"P2", analysis:mk(0.8), timepoint:48 }]);
  eq(M.plates.length, 2, "two plates merged");
  const s = M.sum("Treated","DMD_myo");
  ok(Math.abs(s.rq - Math.sqrt(0.5*0.8)) < 1e-12,
     "the summary is the GEOMETRIC mean of per-plate ratios, not an arithmetic one");
  eq(s.nPlates, 2, "and it says how many plates it rests on");
  ok(M.hasTimepoints === true, "timepoints present on every run");

  const mixed = COMBINE.merge([
    { id:"r1", label:"P1", analysis:mk(0.5,"hRPL10A") },
    { id:"r2", label:"P2", analysis:mk(0.8,"TOP1") }]);
  ok(mixed.warnings.some(w => /reference gene/.test(w.msg)),
     "a mismatched reference gene is warned about, not silently averaged");
  const mixedCal = COMBINE.merge([
    { id:"r1", label:"P1", analysis:mk(0.5,"hRPL10A","A") },
    { id:"r2", label:"P2", analysis:mk(0.8,"hRPL10A","B") }]);
  ok(mixedCal.warnings.some(w => /calibrator/.test(w.msg)), "so is a mismatched calibrator");
  const noTime = COMBINE.merge([
    { id:"r1", label:"P1", analysis:mk(0.5), timepoint:24 },
    { id:"r2", label:"P2", analysis:mk(0.8) }]);
  ok(noTime.hasTimepoints === false, "a missing timepoint is not invented");
  ok(noTime.warnings.some(w => /timepoint/.test(w.msg)), "...and it is reported");
  ok(COMBINE.toCSV(M).split("\r\n")[0].startsWith("Sample group,Target,Plate"), "CSV header");
}

/* --------------------------------------------------------------- dax.js -- */
G("dax.js  - QuantStudio plate setup");
{
  const built = DAX.build({ groups:["G1","G2"], bioReps:3, techReps:2, rowsPerGroup:2,
                            targets:["hRPL10A","DMD_myo"] });
  eq(built.used, 2*2*2*3*2, "well count = groups x rows x targets x bio x tech");
  eq(built.techRepsTotal, 4, "rowsPerGroup x techReps technical replicates per sample");
  const text = DAX.write(built);
  // 6 header lines + 1 column line, then one row per well whether used or not
  eq(text.split("\r\n").filter(l => l.length).length - 7, 384,
     "every well is emitted, used or not");
  const parsed = DAX.parse(text);
  eq(parsed.wells.length, 384, "384 rows parse back");
  eq(parsed.nUsed, built.used, "the same wells come back as used");
  eq(DAX.write(parsed), text, "parse -> write is byte-identical");
  ok(text.includes('"""RGB('), "colours keep the triple-quoting the instrument writes");
  ok(/^\d{4}-/.test("2026-") && /CES?T|UTC|[A-Z]{2,5}/.test(DAX.zoneAbbr(new Date())),
     "a zone abbreviation is produced");
  let threw = false;
  try { DAX.build({ groups:["G"], bioReps:9, techReps:2, targets:["a","b"] }); } catch(e){ threw = true; }
  ok(threw, "a layout too wide for the plate is refused rather than silently truncated");
}

console.log("\n" + (fail ? "FAILED" : "all good") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);

})().catch(e => { console.error("\nharness error:", e); process.exit(2); });
