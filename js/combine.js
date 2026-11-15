/* ============================================================================
   combine.js  -  pooling several qPCR runs for cross-plate analysis.

   The honest way to combine plates is NOT to throw every well into one DDCt.
   ddct.js already warns about that, and it is right to: each plate has its own
   calibrator, its own reverse transcription, its own master mix. Pooling them
   into a single calculation silently asserts a shared baseline that was never
   measured.

   So each run is analysed on its own, with its own calibrator, and the results
   are laid side by side with PLATE KEPT AS A VISIBLE FACTOR. If a plate
   disagrees with its neighbours you see it, instead of it being averaged away.

   A summary across plates is offered, but it is the geometric mean of the
   per-plate RQs - a mean of ratios, each already normalised on its own plate -
   and it is never computed from fewer than two plates without saying so.

   Exposes a global: COMBINE
   ========================================================================= */
var COMBINE = (function(){
  "use strict";

  const K = (a,b) => a + "\u0000" + b;
  const gmean = xs => Math.exp(xs.reduce((s,x)=>s+Math.log(x),0) / xs.length);

  /* runs: [{ id, label, analysis, timepoint? }]
     analysis is whatever DDCT.analyse returned for that one plate. */
  function merge(runs){
    if(!Array.isArray(runs) || !runs.length) throw new Error("No runs to combine.");
    const plates = runs.map((r,i)=>({
      id: r.id || ("run-" + (i+1)),
      label: r.label || r.id || ("Plate " + (i+1)),
      timepoint: (r.timepoint == null || r.timepoint === "") ? null : r.timepoint,
      refTarget: r.analysis.refTarget,
      calibrator: r.analysis.calibrator
    }));

    const groups = [], targets = [], cells = new Map();   // K(group,target) -> [{plate,...}]
    runs.forEach((r,pi)=>{
      for(const v of (typeof DDCT!=="undefined" ? DDCT.table(r.analysis) : tableOf(r.analysis))){
        if(!groups.includes(v.group))  groups.push(v.group);
        if(!targets.includes(v.target)) targets.push(v.target);
        const k = K(v.group, v.target);
        if(!cells.has(k)) cells.set(k, []);
        cells.get(k).push({ plateIndex:pi, plate:plates[pi].label,
                            timepoint:plates[pi].timepoint,
                            rq:v.rq, lo:v.lo, hi:v.hi, n:v.n, cq:v.cq });
      }
    });

    /* Across-plate summary: geometric mean of per-plate ratios. */
    const summary = new Map();
    for(const [k, arr] of cells){
      const vals = arr.map(x=>x.rq).filter(x=>isFinite(x) && x>0);
      if(!vals.length) continue;
      const g = gmean(vals);
      const spread = vals.length>1 ? Math.max(...vals)/Math.min(...vals) : null;
      summary.set(k, { rq:g, nPlates:vals.length, perPlate:vals,
                       foldSpread:spread, single: vals.length === 1 });
    }

    /* Things worth saying out loud rather than burying. */
    const warnings = [];
    const refs = [...new Set(plates.map(p=>p.refTarget))];
    if(refs.length > 1) warnings.push({ lvl:"warn",
      msg:"These runs do not share a reference gene (" + refs.join(", ") +
          "). RQ values normalised against different denominators are not comparable." });
    const cals = [...new Set(plates.map(p=>p.calibrator))];
    if(cals.length > 1) warnings.push({ lvl:"warn",
      msg:"These runs do not share a calibrator (" + cals.join(", ") +
          "). Each plate's values are relative to a different baseline." });

    const partial = [...cells.entries()]
      .filter(([,a]) => a.length < plates.length)
      .map(([k,a]) => k.split("\u0000").join(" / ") + " (" + a.length + "/" + plates.length + ")");
    if(partial.length) warnings.push({ lvl:"info",
      msg: partial.length + " combination(s) are not present on every plate: " +
           partial.slice(0,6).join(", ") + (partial.length>6 ? ", ..." : "") +
           ". Their summary rests on fewer plates than the rest." });

    const wide = [...summary.entries()].filter(([,s]) => s.foldSpread && s.foldSpread > 3)
      .map(([k,s]) => k.split("\u0000").join(" / ") + " (" + s.foldSpread.toFixed(1) + "x)");
    if(wide.length) warnings.push({ lvl:"warn",
      msg:"Plate-to-plate spread above 3-fold for: " + wide.slice(0,6).join(", ") +
          (wide.length>6 ? ", ..." : "") + ". Check the control sits at the same Cq on each." });

    const withTime = plates.filter(p=>p.timepoint != null).length;
    if(withTime && withTime < plates.length) warnings.push({ lvl:"info",
      msg: withTime + " of " + plates.length + " runs carry a timepoint. A time course " +
           "needs one on every run; set it where it is missing rather than inferring it." });

    return { plates, groups, targets, cells, summary, warnings,
             get:(g,t)=>cells.get(K(g,t)) || [],
             sum:(g,t)=>summary.get(K(g,t)) || null,
             hasTimepoints: withTime === plates.length && plates.length > 0 };
  }

  /* Fallback if DDCT is not loaded on the page (tests, node). */
  function tableOf(A){
    const out=[]; for(const g of A.groups) for(const t of A.targets){
      const v=A.res.get(K(g,t)); if(v) out.push(v); } return out;
  }

  /* Long-form rows, for CSV and for anything that wants to re-pivot. */
  function toRows(M){
    const out=[];
    for(const g of M.groups) for(const t of M.targets){
      for(const c of M.get(g,t))
        out.push({ group:g, target:t, plate:c.plate, timepoint:c.timepoint,
                   rq:c.rq, lo:c.lo, hi:c.hi, n:c.n, cq:c.cq });
    }
    return out;
  }
  function toCSV(M){
    const esc = v => v==null ? "" : (/[",\n]/.test(String(v))
      ? '"'+String(v).replace(/"/g,'""')+'"' : String(v));
    const head = ["Sample group","Target","Plate","Timepoint","RQ","RQ lo","RQ hi","n","mean Cq"];
    const lines = [head.join(",")];
    for(const r of toRows(M)) lines.push([r.group,r.target,r.plate,r.timepoint,
      r.rq==null?"":r.rq.toFixed(4), r.lo==null?"":r.lo.toFixed(4),
      r.hi==null?"":r.hi.toFixed(4), r.n, r.cq==null?"":r.cq.toFixed(2)].map(esc).join(","));
    return lines.join("\r\n") + "\r\n";
  }

  return { merge, toRows, toCSV, _gmean:gmean };
})();
if (typeof module !== "undefined") module.exports = COMBINE;
