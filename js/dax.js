/* ============================================================================
   dax.js  -  QuantStudio Design & Analysis plate setup: read and write.

   Format decoded from a real export (Export_PlateSetup_2026-11-15-141522.csv):

     * Block Type = 384-Well Block                 <- CRLF throughout
     * Date Created = Sun Nov 15 14:15:25 CET 2026
     "* Passive Reference = "                      <- CSV-quoted when the value is empty
     "* Barcode = "
     ""                                            <- blank line, quoted
     [Sample Setup]
     Well,Well Position,Sample Name,Sample Color,Biogroup Name,Biogroup Color,
       Target Name,Target Color,Task,Reporter,Quencher,Quantity,Comments
     1,A1,ASO_95_1,"""RGB(0,176,37)""",ASO_95,"""RGB(0,176,37)""",hRPL10A,...

   Notes that matter:
   - Colours are the literal text "RGB(r,g,b)" INCLUDING its quotes, so in CSV
     they appear triple-quoted. Getting this wrong is the obvious way to
     produce a file the instrument rejects.
   - EVERY well is emitted, 1..384. Unused wells are a row of empty fields,
     not an absent row.
   - Well is the 1-based index, Well Position the A1 label, row-major.
   - On a parse the original header lines are kept verbatim, so parse -> write
     is byte-identical. Only a freshly generated file synthesises a header.

   Exposes a global: DAX
   ========================================================================= */
var DAX = (function(){
  "use strict";

  const COLS = ["Well","Well Position","Sample Name","Sample Color","Biogroup Name",
                "Biogroup Color","Target Name","Target Color","Task","Reporter",
                "Quencher","Quantity","Comments"];
  const ROWS = "ABCDEFGHIJKLMNOP";
  /* The palette the instrument software itself used in the observed export. */
  const PALETTE = ["RGB(0,176,37)","RGB(231,19,22)","RGB(0,133,255)","RGB(34,34,34)",
                   "RGB(255,153,0)","RGB(153,0,204)","RGB(0,153,153)","RGB(204,102,0)",
                   "RGB(102,102,255)","RGB(153,153,0)","RGB(204,0,102)","RGB(0,102,51)"];

  const geom = block => /384/.test(block||"") ? {rows:16, cols:24, n:384}
                                              : {rows:8, cols:12, n:96};
  const pos = (i, cols) => ROWS[Math.floor(i/cols)] + (i % cols + 1);

  /* ---- CSV primitives ---------------------------------------------------- */
  function splitCSV(line){
    const out=[]; let cur="", q=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(q){
        if(c === '"'){ if(line[i+1] === '"'){ cur+='"'; i++; } else q=false; }
        else cur+=c;
      } else if(c === '"') q=true;
      else if(c === ","){ out.push(cur); cur=""; }
      else cur+=c;
    }
    out.push(cur); return out;
  }
  /* Quote exactly when the instrument does: any comma, quote, or leading or
     trailing space in the value. An unquoted RGB(0,176,37) would be read as
     three columns. */
  function q(v){
    const s = v==null ? "" : String(v);
    if(s === "") return "";
    return /[",]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }

  /* ---- parse -------------------------------------------------------------- */
  function parse(text){
    const lines = String(text).replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
    const header = {}, headerRaw = [];
    let i = 0, section = null;
    for(; i<lines.length; i++){
      const raw = lines[i];
      if(raw.trim() === "[Sample Setup]"){ section = "setup"; headerRaw.push(raw); i++; break; }
      headerRaw.push(raw);
      const flat = splitCSV(raw)[0] || "";
      const m = flat.match(/^\*\s*([^=]+?)\s*=\s*(.*)$/);
      if(m) header[m[1].trim()] = m[2].trim();
    }
    if(section !== "setup") throw new Error("No [Sample Setup] section - is this a plate setup export?");
    const colLine = lines[i++];
    const cols = splitCSV(colLine).map(s=>s.trim());
    const need = ["Well","Well Position","Sample Name","Target Name"];
    const missing = need.filter(c=>!cols.includes(c));
    if(missing.length) throw new Error("Plate setup is missing column(s): " + missing.join(", "));
    const ix = {}; cols.forEach((c,k)=>ix[c]=k);
    const wells = [];
    for(; i<lines.length; i++){
      if(!lines[i].trim()) continue;
      if(/^\[/.test(lines[i].trim())) break;              // a later section, if any
      const f = splitCSV(lines[i]);
      const get = c => ix[c]==null ? "" : (f[ix[c]]||"");
      if(!get("Well")) continue;
      wells.push({ well:+get("Well"), position:get("Well Position"),
        sample:get("Sample Name"), sampleColor:get("Sample Color"),
        biogroup:get("Biogroup Name"), biogroupColor:get("Biogroup Color"),
        target:get("Target Name"), targetColor:get("Target Color"),
        task:get("Task"), reporter:get("Reporter"), quencher:get("Quencher"),
        quantity:get("Quantity"), comments:get("Comments") });
    }
    const block = header["Block Type"] || "";
    const used = wells.filter(w=>w.sample && w.target);
    return { header, headerRaw, colLine, cols, wells, block, geom:geom(block),
             samples:[...new Set(used.map(w=>w.sample))],
             biogroups:[...new Set(used.map(w=>w.biogroup).filter(Boolean))],
             targets:[...new Set(used.map(w=>w.target))],
             reporters:[...new Set(used.map(w=>w.reporter).filter(Boolean))],
             nUsed:used.length };
  }

  /* ---- date, in the instrument's own style -------------------------------- */
  /* "Sun Nov 15 14:15:25 CET 2026" - Java Date.toString(). The zone
     abbreviation is not derivable reliably from Intl, so it is built from the
     long name: drop "Standard", take initials. Central European Standard Time
     -> CET; Central European Summer Time -> CEST. Falls back to the browser's
     short name. Cosmetic: a round-tripped file reuses the original header. */
  function zoneAbbr(d){
    try{
      const long = new Intl.DateTimeFormat("en-US",{ timeZoneName:"long" })
        .formatToParts(d).find(p=>p.type==="timeZoneName");
      if(long && /\s/.test(long.value))
        return long.value.split(/\s+/).filter(w=>w!=="Standard")
                 .map(w=>w[0]).join("").toUpperCase();
      if(long) return long.value;
    }catch(e){}
    try{
      return new Intl.DateTimeFormat("en-US",{ timeZoneName:"short" })
        .formatToParts(d).find(p=>p.type==="timeZoneName").value;
    }catch(e){ return "UTC"; }
  }
  function javaDate(d){
    const D=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], M=["Jan","Feb","Mar","Apr","May","Jun",
      "Jul","Aug","Sep","Oct","Nov","Dec"], p=n=>String(n).padStart(2,"0");
    return `${D[d.getDay()]} ${M[d.getMonth()]} ${String(d.getDate()).padStart(2," ")} `
         + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${zoneAbbr(d)} ${d.getFullYear()}`;
  }

  /* ---- write -------------------------------------------------------------- */
  /* setup: { block, wells, header?, headerRaw?, colLine? }
     wells may be sparse; every well index is emitted regardless. */
  function write(setup){
    const g = geom(setup.block || "384-Well Block");
    const byIndex = new Map();
    for(const w of (setup.wells||[])){
      const i = w.well || ((ROWS.indexOf((w.position||"")[0]) * g.cols) +
                           parseInt(String(w.position||"").slice(1),10));
      if(i>=1 && i<=g.n) byIndex.set(i, w);
    }
    // consistent colours per sample / biogroup / target, unless already set
    const assign = (key, map) => {
      if(!key) return "";
      if(!map.has(key)) map.set(key, '"'+PALETTE[map.size % PALETTE.length]+'"');
      return map.get(key);
    };
    const cs=new Map(), cb=new Map(), ct=new Map();
    const lines = [];
    if(setup.headerRaw && setup.headerRaw.length){
      lines.push(...setup.headerRaw);                      // byte-identical round-trip
    } else {
      const h = setup.header || {};
      lines.push("* Block Type = " + (h["Block Type"] || setup.block || "384-Well Block"));
      lines.push("* Date Created = " + (h["Date Created"] || javaDate(new Date())));
      lines.push(q("* Passive Reference = " + (h["Passive Reference"]||"")));
      lines.push(q("* Barcode = " + (h["Barcode"]||"")));
      lines.push('""');
      lines.push("[Sample Setup]");
    }
    lines.push(setup.colLine || COLS.join(","));
    for(let i=1;i<=g.n;i++){
      const w = byIndex.get(i);
      if(!w || !w.sample || !w.target){
        lines.push([i, pos(i-1,g.cols), "","","","","","","","","","",""].map(q).join(","));
        continue;
      }
      lines.push([ i, w.position || pos(i-1,g.cols), w.sample,
        w.sampleColor   || assign(w.sample,   cs),
        w.biogroup || "",
        w.biogroup ? (w.biogroupColor || assign(w.biogroup, cb)) : "",
        w.target,
        w.targetColor   || assign(w.target,   ct),
        w.task || "UNKNOWN", w.reporter || "FAM",
        w.quencher||"", w.quantity||"", w.comments||"" ].map(q).join(","));
    }
    return lines.join("\r\n") + "\r\n";
  }

  /* ---- build a layout from scratch ----------------------------------------
     Reproduces this lab's own convention, decoded from a real export:
       - one biogroup per row BAND; rowsPerGroup rows each (observed: 2)
       - within a row: targets in contiguous blocks, and inside each block the
         biological replicates in order, each with techReps adjacent wells
       - the extra rows of a band repeat the block, so rowsPerGroup x techReps
         is the total number of technical replicates per sample and target
     Observed plate: 7 groups, 2 rows each, 4 targets, 3 bio, 2 adjacent
     duplicates = 24 columns per row, 336 wells, rows O and P unused. */
  function build(opts){
    const o = Object.assign({ block:"384-Well Block", groups:[], bioReps:3, techReps:2,
                              rowsPerGroup:2, targets:[], task:"UNKNOWN", reporter:"FAM" }, opts||{});
    const g = geom(o.block);
    const perTarget = o.bioReps * o.techReps;
    const need = o.targets.length * perTarget;
    if(need > g.cols) throw new Error(
      `${o.targets.length} targets x ${o.bioReps} bio x ${o.techReps} tech = ${need} columns, `+
      `but a row of this plate has ${g.cols}.`);
    const bands = Math.floor(g.rows / o.rowsPerGroup);
    const wells = [];
    o.groups.forEach((grp,gi)=>{
      if(gi >= bands) return;
      for(let rep=0; rep<o.rowsPerGroup; rep++){
        const row = gi*o.rowsPerGroup + rep;
        o.targets.forEach((t,ti)=>{
          for(let b=0;b<o.bioReps;b++) for(let r=0;r<o.techReps;r++){
            const col = ti*perTarget + b*o.techReps + r;
            const idx = row*g.cols + col + 1;
            wells.push({ well:idx, position:pos(idx-1,g.cols),
                         sample:`${grp}_${b+1}`, biogroup:grp, target:t,
                         task:o.task, reporter:o.reporter });
          }
        });
      }
    });
    return { block:o.block, wells, used:wells.length, capacity:g.n,
             bands, rowsUsed:Math.min(o.groups.length,bands)*o.rowsPerGroup,
             techRepsTotal:o.rowsPerGroup*o.techReps,
             overflow:o.groups.length > bands ? o.groups.slice(bands) : [] };
  }
  return { COLS, PALETTE, geom, parse, write, build, javaDate, zoneAbbr, _splitCSV:splitCSV, _q:q };
})();
if (typeof module !== "undefined") module.exports = DAX;
