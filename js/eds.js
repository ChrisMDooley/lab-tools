/* ============================================================================
   eds.js  -  read QuantStudio .eds files in the browser
   No dependencies. A .eds is a ZIP of JSON; we read the central directory by
   hand and inflate with the platform's own DecompressionStream.
   Exposes a global: EDS
   ========================================================================= */
var EDS = (function(){
  "use strict";

  /* --- ZIP ---------------------------------------------------------------- */
  async function readZip(buf){
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for(let i = buf.byteLength-22; i >= Math.max(0, buf.byteLength-66000); i--)
      if(dv.getUint32(i,true) === 0x06054b50){ eocd = i; break; }
    if(eocd < 0) throw new Error("Not a ZIP archive - is this really a .eds file?");
    const n = dv.getUint16(eocd+10,true);
    let p = dv.getUint32(eocd+16,true);
    const entries = Object.create(null);
    for(let k=0;k<n;k++){
      if(dv.getUint32(p,true) !== 0x02014b50) throw new Error("Damaged ZIP central directory");
      const method = dv.getUint16(p+10,true), csize = dv.getUint32(p+20,true),
            usize  = dv.getUint32(p+24,true), nlen  = dv.getUint16(p+28,true),
            elen   = dv.getUint16(p+30,true), clen  = dv.getUint16(p+32,true),
            lho    = dv.getUint32(p+42,true);
      const name = new TextDecoder().decode(u8.subarray(p+46, p+46+nlen));
      entries[name] = { method, csize, usize, lho };
      p += 46 + nlen + elen + clen;
    }
    async function get(name){
      const e = entries[name];
      if(!e) throw new Error("Missing from archive: " + name);
      const nlen = dv.getUint16(e.lho+26,true), elen = dv.getUint16(e.lho+28,true);
      const start = e.lho + 30 + nlen + elen, raw = u8.subarray(start, start+e.csize);
      if(e.method === 0) return raw;                       // stored
      if(e.method !== 8) throw new Error("Unsupported ZIP compression method " + e.method);
      const ds = new DecompressionStream("deflate-raw");
      const ab = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(ab);
    }
    return { names: Object.keys(entries), entries, get,
             text: async n => new TextDecoder().decode(await get(n)) };
  }

  /* --- JSON -------------------------------------------------------------- */
  /* The instrument writes bare NaN and Infinity, which are NOT valid JSON.
     Python's json module accepts them; JSON.parse does not. Replace only where
     a value is expected, so a sample name containing those letters survives. */
  function parseJSON(txt){
    return JSON.parse(txt.replace(/([:,\[]\s*)(-?)(NaN|Infinity)\b/g, "$1null"));
  }

  const ROWS = "ABCDEFGHIJKLMNOP";
  function wellPos(i, cols){ return ROWS[Math.floor(i/cols)] + (i % cols + 1); }

  /* --- the file ---------------------------------------------------------- */
  async function parse(buf, filename){
    const z = await readZip(buf);
    const need = n => { if(!z.entries[n]) throw new Error("Not a QuantStudio .eds file (missing "+n+")"); };
    need("primary/analysis_result.json");
    const a = parseJSON(await z.text("primary/analysis_result.json"));
    let setup = {}, rq = {};
    if(z.entries["setup/plate_setup.json"]) setup = parseJSON(await z.text("setup/plate_setup.json"));
    if(z.entries["extensions/am.rq/relative_quantification_setting.json"])
      rq = parseJSON(await z.text("extensions/am.rq/relative_quantification_setting.json"));

    const block = setup.blockType || "";
    const cols  = /384/.test(block) ? 24 : 12;
    const rows  = [];
    for(const w of (a.wellResults || [])){
      const idx = w.wellIndex;
      for(const r of (w.reactionResults || [])){
        const am = r.amplificationResult || {};
        rows.push({
          well: wellPos(idx, cols), idx,
          sample: w.sampleName || "", target: r.targetName || "", task: r.task || "",
          cq: am.cq, cqConf: am.cqConf, amp: am.ampStatus, tm: firstTm(r.meltResult),
          omitted: !!r.omitted, qcFail: !!r.curveQCFailed,
          issues: r.resultQCIssues || []
        });
      }
    }
    const biogroup = Object.create(null);
    for(const s of (setup.samples || [])) biogroup[s.name] = s.biogroup || null;
    // Fall back to stripping a trailing _N, which is this lab's own convention.
    for(const r of rows) if(!(r.sample in biogroup))
      biogroup[r.sample] = r.sample.replace(/_(\d+)$/, "") || r.sample;

    return {
      filename: filename || "", block, cols, rows,
      targets: (setup.targets || []).map(t => t.name),
      reporters: Object.fromEntries((setup.targets||[]).map(t=>[t.name,t.reporter])),
      biogroup,
      endo: rq.endoControlTargetNames || [],
      refSample: rq.refSampleName || null,
      refGroup: rq.refGroupName || null,
      wells: (a.wellResults || []).length
    };
  }
  function firstTm(m){
    if(!m) return null;
    const t = m.tm || m.meltTemperatures || m.tms;
    return Array.isArray(t) && t.length ? t[0] : (typeof t === "number" ? t : null);
  }
  async function parseFile(file){
    return parse(await file.arrayBuffer(), file.name);
  }
  return { readZip, parseJSON, parse, parseFile, wellPos };
})();
if (typeof module !== "undefined") module.exports = EDS;
