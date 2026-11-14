/* ============================================================================
   ddct.js  -  relative quantification (Livak / delta-delta-Ct)
   Pure: no DOM, no I/O. Everything the UI shows comes from here, so it can be
   validated independently. Exposes a global: DDCT
   ========================================================================= */
var DDCT = (function(){
  "use strict";

  /* Reactions are dropped for exactly these reasons, each one reported.
     cqConf matters: an October 2026 plate carried a well flagged AMP with a
     plausible Cq of 23.51 against 29.3-30.2 for its siblings and a confidence
     of 0.031. Because the instrument calibrates on that sample it had crushed
     an entire panel. Nothing is ever dropped silently. */
  const DEFAULTS = { minCqConf: 0.5, maxCq: 40, dropQCFail: false };

  function qcReason(r, o){
    if(r.omitted) return "omitted by operator";
    if(o.dropQCFail && r.qcFail) return "curve QC failed";
    const c = r.cq;
    if(c === null || c === undefined || typeof c !== "number" || !isFinite(c)) return "undetermined";
    if(c <= 0) return "undetermined";                        // -1.0 sentinel
    if(o.maxCq && c > o.maxCq) return "Cq above " + o.maxCq;
    const k = r.cqConf;
    if(k === null || k === undefined || !isFinite(k)) return "no confidence value";
    if(k < o.minCqConf) return "cqConf " + k.toFixed(3) + " below " + o.minCqConf;
    return null;
  }

  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  function sd(a){ if(a.length<2) return 0; const m=mean(a);
    return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1)); }

  /* plates: one or more objects from EDS.parse. Analysed together, so a
     calibrator on one plate can serve samples on another - but see the
     cross-plate warning, because that is rarely safe. */
  function analyse(plates, opts){
    const o = Object.assign({}, DEFAULTS, opts||{});
    if(!Array.isArray(plates)) plates = [plates];
    const biogroup = Object.create(null), allTargets = [], plateOf = Object.create(null);
    for(const p of plates){
      Object.assign(biogroup, p.biogroup);
      for(const t of p.targets) if(!allTargets.includes(t)) allTargets.push(t);
    }
    const refTarget = o.refTarget ||
      (plates.find(p=>p.endo && p.endo.length) || {endo:[]}).endo[0] || allTargets[0];

    // collect technical replicates
    const bucket = new Map(), drops = new Map();
    for(const p of plates) for(const r of p.rows){
      if(!r.sample || !r.target) continue;
      const why = qcReason(r, o);
      if(why){
        if(!drops.has(why)) drops.set(why, []);
        drops.get(why).push({ plate:p.filename, well:r.well, sample:r.sample,
                              target:r.target, cq:r.cq, cqConf:r.cqConf });
        continue;
      }
      const k = r.sample + "\u0000" + r.target;
      if(!bucket.has(k)) bucket.set(k, { cqs:[], wells:[], plate:p.filename });
      bucket.get(k).cqs.push(r.cq); bucket.get(k).wells.push(r.well);
      plateOf[r.sample] = p.filename;
    }
    const meanCq = new Map();
    for(const [k,v] of bucket) meanCq.set(k, { cq:mean(v.cqs), sd:sd(v.cqs),
                                               n:v.cqs.length, wells:v.wells, plate:v.plate });
    const key = (s,t) => s + "\u0000" + t;
    const samples = [...new Set([...bucket.keys()].map(k=>k.split("\u0000")[0]))].sort();
    const targets = allTargets.filter(t => t !== refTarget);

    // dCt = target - reference gene, within a sample
    const dCt = new Map(), noRef = [];
    for(const s of samples){
      const rk = key(s, refTarget);
      if(!meanCq.has(rk)){ noRef.push(s); continue; }
      for(const t of targets){
        const tk = key(s,t);
        if(meanCq.has(tk)) dCt.set(tk, meanCq.get(tk).cq - meanCq.get(rk).cq);
      }
    }
    // calibrator: a biogroup. Its own RQ then lands on exactly 1.000.
    const groups = [...new Set(samples.map(s => biogroup[s] || s))].sort();
    const cal = o.calibrator || (plates[0] && plates[0].refGroup) ||
                (plates[0] && plates[0].refSample ? biogroup[plates[0].refSample] : null) || groups[0];
    const calSamples = samples.filter(s => (biogroup[s]||s) === cal);

    const res = new Map(), warnings = [];
    for(const t of targets){
      const cv = calSamples.map(s=>dCt.get(key(s,t))).filter(v=>v!==undefined);
      if(!cv.length){ warnings.push({lvl:"err",
        msg:"Calibrator “"+cal+"” has no usable "+t+" data, so "+t+" cannot be scaled."}); continue; }
      const dctCal = mean(cv);
      const byGroup = new Map();
      for(const s of samples){
        const v = dCt.get(key(s,t)); if(v===undefined) continue;
        const g = biogroup[s]||s;
        if(!byGroup.has(g)) byGroup.set(g,[]);
        byGroup.get(g).push({ sample:s, rq: Math.pow(2, -(v-dctCal)) });
      }
      for(const [g,arr] of byGroup){
        // geometric mean: RQ is a ratio, so the arithmetic mean is the wrong
        // centre and would not put the calibrator on exactly 1.
        const lg = arr.map(x=>Math.log2(x.rq));
        const m = mean(lg), se = arr.length>1 ? sd(lg)/Math.sqrt(arr.length) : 0;
        res.set(g+"\u0000"+t, { group:g, target:t, rq:Math.pow(2,m),
          lo:Math.pow(2,m-se), hi:Math.pow(2,m+se), n:arr.length,
          reps:arr.map(x=>x.rq), repSamples:arr.map(x=>x.sample),
          cq: meanCq.has(key(arr[0].sample,t)) ? mean(arr.map(x=>
                meanCq.has(key(x.sample,t)) ? meanCq.get(key(x.sample,t)).cq : NaN)) : null });
      }
    }
    // reference-gene stability: the denominator every number rests on
    const refCq = samples.filter(s=>meanCq.has(key(s,refTarget)))
      .map(s=>({ sample:s, group:biogroup[s]||s, cq:meanCq.get(key(s,refTarget)).cq }));
    const refVals = refCq.map(x=>x.cq);
    const refStats = refVals.length ? { mean:mean(refVals), sd:sd(refVals),
      min:Math.min(...refVals), max:Math.max(...refVals),
      range:Math.max(...refVals)-Math.min(...refVals) } : null;
    if(refStats && refStats.range > 2) warnings.push({ lvl:"warn",
      msg:"The reference gene "+refTarget+" spans "+refStats.range.toFixed(2)+
          " Cq across samples. Every ratio is measured against a denominator the treatment has moved; "+
          "consider two or three reference genes averaged." });
    if(noRef.length) warnings.push({ lvl:"warn",
      msg:noRef.length+" sample(s) have no usable "+refTarget+" and were excluded: "+noRef.join(", ") });
    if(plates.length > 1) warnings.push({ lvl:"info",
      msg:"Analysing "+plates.length+" plates together. Plates rarely share a baseline - "+
          "check the control sits at the same Cq on each before comparing across them." });

    return { refTarget, calibrator:cal, groups, targets, samples, res, meanCq,
             dCt, drops, warnings, refCq, refStats, biogroup, plateOf,
             options:o, nDropped:[...drops.values()].reduce((s,a)=>s+a.length,0) };
  }

  function table(A){
    const out = [];
    for(const g of A.groups) for(const t of A.targets){
      const v = A.res.get(g+"\u0000"+t);
      if(v) out.push(v);
    }
    return out;
  }
  function toCSV(A){
    const h = ["group","target","rq","se_lo","se_hi","n_biological_reps","replicate_rqs","mean_cq"];
    const rows = table(A).map(v=>[v.group,v.target,v.rq.toFixed(4),v.lo.toFixed(4),v.hi.toFixed(4),
      v.n, v.reps.map(x=>x.toFixed(4)).join(" "), v.cq==null?"":v.cq.toFixed(2)]);
    return [h, ...rows].map(r=>r.map(x=>/[",]/.test(String(x))?'"'+x+'"':x).join(",")).join("\n");
  }
  return { DEFAULTS, qcReason, analyse, table, toCSV };
})();
if (typeof module !== "undefined") module.exports = DDCT;
