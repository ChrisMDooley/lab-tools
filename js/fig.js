/* ============================================================================
   fig.js  -  SVG figures. Returns strings, touches no DOM, so a figure can be
   generated and checked without a page. Exposes a global: FIG
   Palette: Wes Anderson "Zissou1", the lab's standing convention.
   ========================================================================= */
var FIG = (function(){
  "use strict";
  const ZISSOU = ["#3B9AB2","#78B7C5","#EBCC2A","#E1AF00","#F21A00"];
  const INK="#1b1b1b", MUTE="#78766f", LINE="#d8d6d0", FAINT="#edebe7";
  const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  function lerp(a,b,t){ return a+(b-a)*t; }
  function hex2rgb(h){ return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]; }
  function rgb2hex(c){ return "#"+c.map(x=>Math.round(x).toString(16).padStart(2,"0")).join(""); }
  /* Continuous interpolation across the 5 anchors, so any number of groups
     gets distinct colours instead of recycling after five. */
  function palette(n){
    if(n<=1) return [ZISSOU[0]];
    const out=[];
    for(let i=0;i<n;i++){
      const x = i/(n-1)*(ZISSOU.length-1), k = Math.min(Math.floor(x), ZISSOU.length-2), t = x-k;
      const a=hex2rgb(ZISSOU[k]), b=hex2rgb(ZISSOU[k+1]);
      out.push(rgb2hex([lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)]));
    }
    return out;
  }
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function niceMax(v){
    if(!(v>0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v))), m = v/e;
    return (m<=1?1: m<=1.5?1.5: m<=2?2: m<=2.5?2.5: m<=3?3: m<=4?4: m<=5?5: m<=8?8:10)*e;
  }

  /* Faceted RQ chart: one panel per target, groups along x.
     bars = geometric mean, whiskers = +/-1 SE in log space, dots = biological
     replicates, rotated number above each bar = that group's mean Cq. */
  function rqChart(A, opt){
    const o = Object.assign({ width:1000, panelH:230, showCq:true, showDots:true,
      calLine:true, title:"", subtitle:"", groups:null, targets:null, logY:false }, opt||{});
    const targets = o.targets || A.targets;
    const groups  = (o.groups || A.groups).filter(g =>
      targets.some(t => A.res.has(g+"\u0000"+t)));
    if(!targets.length || !groups.length)
      return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60"><text x="8" y="34"
        font-family="${FONT}" font-size="13" fill="${MUTE}">Nothing to plot yet.</text></svg>`;
    const cols = palette(groups.length);
    const L=66, R=18, T=o.title?82:30, GAP=56, PH=o.panelH;
    const W=o.width, innerW = W-L-R;
    const H = T + targets.length*(PH+GAP) + 54;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
      font-family="${FONT}"><rect width="${W}" height="${H}" fill="#fff"/>`;
    if(o.title) s += `<text x="${L}" y="26" font-size="17" font-weight="600" fill="${INK}">${esc(o.title)}</text>`;
    if(o.subtitle) s += `<text x="${L}" y="46" font-size="11.5" fill="${MUTE}">${esc(o.subtitle)}</text>`;

    targets.forEach((t,ti)=>{
      const y0 = T + ti*(PH+GAP), y1 = y0+PH;
      const vals = groups.flatMap(g=>{ const v=A.res.get(g+"\u0000"+t);
        return v? [v.hi, ...v.reps] : []; });
      const top = niceMax(Math.max(1.05, ...vals));
      const yS = v => y1 - Math.max(0, Math.min(v,top))/top*PH;
      s += `<text x="${L}" y="${y0-9}" font-size="13" font-weight="600" fill="${INK}">${esc(t)}</text>`;
      // gridlines
      const ticks=5;
      for(let k=0;k<=ticks;k++){
        const v = top*k/ticks, y = yS(v);
        s += `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W-R}" y2="${y.toFixed(1)}"
               stroke="${k===0?LINE:FAINT}" stroke-width="1"/>`;
        s += `<text x="${L-8}" y="${(y+3.5).toFixed(1)}" font-size="10" fill="${MUTE}"
               text-anchor="end" font-family="ui-monospace,monospace">${v%1?v.toFixed(1):v}</text>`;
      }
      if(o.calLine){
        const y = yS(1);
        s += `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W-R}" y2="${y.toFixed(1)}"
               stroke="#55534e" stroke-width="1.1" stroke-dasharray="5 4"/>`;
        s += `<text x="${W-R-3}" y="${(y-5).toFixed(1)}" font-size="9.5" fill="#55534e"
               text-anchor="end">calibrator: ${esc(A.calibrator)}</text>`;
      }
      const bw = innerW/groups.length, bar = Math.min(42, bw*0.56);
      groups.forEach((g,gi)=>{
        const v = A.res.get(g+"\u0000"+t); if(!v) return;
        const cx = L + bw*(gi+0.5);
        s += `<rect x="${(cx-bar/2).toFixed(1)}" y="${yS(v.rq).toFixed(1)}"
               width="${bar.toFixed(1)}" height="${(y1-yS(v.rq)).toFixed(1)}"
               fill="${cols[gi]}" opacity="0.92"/>`;
        if(v.n>1){
          s += `<line x1="${cx.toFixed(1)}" y1="${yS(v.lo).toFixed(1)}" x2="${cx.toFixed(1)}"
                 y2="${yS(v.hi).toFixed(1)}" stroke="${INK}" stroke-width="1.2"/>`;
          [v.lo,v.hi].forEach(e=>{ s += `<line x1="${(cx-5).toFixed(1)}" y1="${yS(e).toFixed(1)}"
                 x2="${(cx+5).toFixed(1)}" y2="${yS(e).toFixed(1)}" stroke="${INK}" stroke-width="1.2"/>`; });
        }
        if(o.showDots) v.reps.forEach((rq,k)=>{
          const dx = cx + (v.reps.length>1 ? (k-(v.reps.length-1)/2)*7 : 0);
          s += `<circle cx="${dx.toFixed(1)}" cy="${yS(rq).toFixed(1)}" r="3.4"
                 fill="#fff" stroke="${INK}" stroke-width="1.1"/>`;
        });
        if(o.showCq && v.cq!=null && isFinite(v.cq)){
          const y = Math.min(yS(v.hi), yS(v.rq)) - 11;
          s += `<text x="${cx.toFixed(1)}" y="${y.toFixed(1)}" font-size="9.5" font-weight="600"
                 fill="${MUTE}" text-anchor="middle" font-family="ui-monospace,monospace"
                 transform="rotate(-90 ${cx.toFixed(1)} ${y.toFixed(1)})">${v.cq.toFixed(1)}</text>`;
        }
        if(ti===targets.length-1){
          s += `<text x="${cx.toFixed(1)}" y="${(y1+13).toFixed(1)}" font-size="10.5" fill="${INK}"
                 text-anchor="end" transform="rotate(-38 ${cx.toFixed(1)} ${(y1+13).toFixed(1)})">${esc(g)}</text>`;
        }
      });
      s += `<text transform="rotate(-90 14 ${((y0+y1)/2).toFixed(1)})" x="14"
             y="${((y0+y1)/2).toFixed(1)}" font-size="10.5" fill="${MUTE}"
             text-anchor="middle">relative quantity</text>`;
    });
    s += `<text x="${L}" y="${H-8}" font-size="9.5" fill="${MUTE}">bars = geometric mean of
      ${groups.map(g=>{const v=targets.map(t=>A.res.get(g+"\u0000"+t)).find(Boolean);return v?v.n:0;})
      .reduce((a,b)=>Math.max(a,b),0)} biological replicates ± 1 SE in log space · dots =
      individual replicates${o.showCq?" · rotated number = group mean Cq":""} ·
      normalised to ${esc(A.refTarget)}</text></svg>`;
    return s;
  }

  /* Reference-gene stability: the denominator every ratio rests on. */
  function refChart(A, opt){
    const o = Object.assign({ width:1000, height:250, title:"" }, opt||{});
    const pts = A.refCq.slice().sort((a,b)=>a.group.localeCompare(b.group)||a.sample.localeCompare(b.sample));
    if(!pts.length) return "";
    const L=66,R=18,T=o.title?52:22,B=66, W=o.width, H=o.height;
    const cqs = pts.map(p=>p.cq);
    let lo=Math.min(...cqs), hi=Math.max(...cqs);
    const pad=Math.max(0.35,(hi-lo)*0.18); lo-=pad; hi+=pad;
    const yS = v => (H-B) - (v-lo)/(hi-lo)*(H-B-T);
    const groups=[...new Set(pts.map(p=>p.group))], cols=palette(groups.length);
    let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
      font-family="${FONT}"><rect width="${W}" height="${H}" fill="#fff"/>`;
    if(o.title) s+=`<text x="${L}" y="24" font-size="15" font-weight="600" fill="${INK}">${esc(o.title)}</text>`;
    s+=`<text x="${L}" y="${o.title?42:20}" font-size="11" fill="${MUTE}">${esc(A.refTarget)} raw Cq per sample ·
      SD ${A.refStats.sd.toFixed(2)} · range ${A.refStats.range.toFixed(2)} Cq · a flat line is what you want</text>`;
    for(let k=0;k<=4;k++){
      const v=lo+(hi-lo)*k/4, y=yS(v);
      s+=`<line x1="${L}" y1="${y.toFixed(1)}" x2="${W-R}" y2="${y.toFixed(1)}" stroke="${FAINT}"/>`;
      s+=`<text x="${L-8}" y="${(y+3.5).toFixed(1)}" font-size="10" fill="${MUTE}" text-anchor="end"
            font-family="ui-monospace,monospace">${v.toFixed(1)}</text>`;
    }
    const ym=yS(A.refStats.mean);
    s+=`<line x1="${L}" y1="${ym.toFixed(1)}" x2="${W-R}" y2="${ym.toFixed(1)}" stroke="#55534e"
          stroke-width="1.1" stroke-dasharray="5 4"/>`;
    const bw=(W-L-R)/pts.length;
    pts.forEach((p,i)=>{
      const cx=L+bw*(i+0.5), c=cols[groups.indexOf(p.group)];
      s+=`<line x1="${cx.toFixed(1)}" y1="${yS(p.cq).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${H-B}"
            stroke="${c}" stroke-width="1" opacity=".45"/>`;
      s+=`<circle cx="${cx.toFixed(1)}" cy="${yS(p.cq).toFixed(1)}" r="4" fill="${c}"/>`;
      s+=`<text x="${cx.toFixed(1)}" y="${H-B+12}" font-size="9.5" fill="${INK}" text-anchor="end"
            transform="rotate(-42 ${cx.toFixed(1)} ${H-B+12})">${esc(p.sample)}</text>`;
    });
    return s+`</svg>`;
  }
  async function svgToPng(svg, scale){
    const blob = new Blob([svg],{type:"image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    try{
      const img = new Image();
      await new Promise((ok,bad)=>{ img.onload=ok; img.onerror=()=>bad(new Error("render failed")); img.src=url; });
      const k = scale||3, c = document.createElement("canvas");
      c.width = img.width*k; c.height = img.height*k;
      const g = c.getContext("2d");
      g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height);
      g.setTransform(k,0,0,k,0,0); g.drawImage(img,0,0);
      return await new Promise(r=>c.toBlob(r,"image/png"));
    } finally { URL.revokeObjectURL(url); }
  }

  /* ===== cross-plate figures =========================================== */
  /* All three take a COMBINE.merge() result, not a single analysis. */

  /* Combined bars: one panel per target, groups along x, and within each group
     one bar PER PLATE. The plate is a visible factor on purpose - averaging
     plates together would hide exactly the batch effect worth seeing. The
     across-plate geometric mean is drawn as a short rule over the cluster. */
  function comboChart(M, opt){
    const o = Object.assign({ width:1100, panelH:240, title:"", subtitle:"",
      groups:null, targets:null, showMean:true }, opt||{});
    const targets = o.targets || M.targets;
    const groups  = (o.groups || M.groups).filter(g => targets.some(t => M.get(g,t).length));
    if(!targets.length || !groups.length) return empty();
    const cols = palette(M.plates.length);
    const L=66, R=18, T=o.title?82:30, GAP=58, PH=o.panelH, W=o.width;
    const innerW = W-L-R, H = T + targets.length*(PH+GAP) + 76;
    let s = head(W,H) + titles(o,L);

    targets.forEach((t,ti)=>{
      const y0 = T + ti*(PH+GAP), y1 = y0+PH;
      const vals = groups.flatMap(g => M.get(g,t).map(c=>c.hi!=null?c.hi:c.rq));
      const top = niceMax(Math.max(1.05, ...vals.filter(isFinite)));
      const yS = v => y1 - Math.max(0, Math.min(v,top))/top*PH;
      s += `<text x="${L}" y="${y0-9}" font-size="13" font-weight="600" fill="${INK}">${esc(t)}</text>`;
      s += axis(L,innerW,y0,y1,top,yS);
      const gw = innerW/groups.length;
      groups.forEach((g,gi)=>{
        const cells = M.get(g,t);
        const x0 = L + gi*gw, pad = gw*0.14, bw = (gw-2*pad)/Math.max(cells.length,1);
        cells.forEach((c,ci)=>{
          const x = x0+pad+ci*bw, w = Math.max(2, bw*0.82);
          s += `<rect x="${(x).toFixed(1)}" y="${yS(c.rq).toFixed(1)}" width="${w.toFixed(1)}"
                 height="${(y1-yS(c.rq)).toFixed(1)}" fill="${cols[c.plateIndex]}" opacity="0.92"/>`;
          if(c.lo!=null && c.hi!=null){
            const xc = x+w/2;
            s += `<line x1="${xc.toFixed(1)}" y1="${yS(c.lo).toFixed(1)}" x2="${xc.toFixed(1)}"
                   y2="${yS(c.hi).toFixed(1)}" stroke="${INK}" stroke-width="1"/>`;
          }
        });
        const sm = M.sum(g,t);
        if(o.showMean && sm && !sm.single){
          const y = yS(sm.rq);
          s += `<line x1="${(x0+pad).toFixed(1)}" y1="${y.toFixed(1)}"
                 x2="${(x0+gw-pad).toFixed(1)}" y2="${y.toFixed(1)}"
                 stroke="${INK}" stroke-width="1.6" stroke-dasharray="5 3"/>`;
        }
        s += `<text x="${(x0+gw/2).toFixed(1)}" y="${y1+15}" font-size="10.5"
               text-anchor="middle" fill="${INK}">${esc(g)}</text>`;
      });
      s += `<line x1="${L}" y1="${yS(1).toFixed(1)}" x2="${L+innerW}" y2="${yS(1).toFixed(1)}"
             stroke="${MUTE}" stroke-width="1" stroke-dasharray="3 3"/>`;
    });
    s += legend(M.plates.map(p=>p.label), cols, L, H-34);
    if(o.showMean) s += `<text x="${W-R}" y="${H-12}" font-size="10" text-anchor="end"
      fill="${MUTE}">dashed rule = geometric mean across plates</text>`;
    return s + "</svg>";
  }

  /* Heatmap: sample group x target, colour = RQ on a log scale centred on 1,
     so "no change" is the neutral midpoint and up and down are symmetric.
     A cell measured on only one plate is marked, because it is weaker
     evidence than one agreed by four. */
  function heatmap(M, opt){
    const o = Object.assign({ cell:46, title:"", subtitle:"", groups:null,
      targets:null, maxFold:4, showValues:true }, opt||{});
    const targets = o.targets || M.targets;
    const groups  = (o.groups || M.groups).filter(g => targets.some(t => M.sum(g,t)));
    if(!targets.length || !groups.length) return empty();
    const CW = o.cell, CH = o.cell*0.78;
    const L = 18 + Math.max(...targets.map(t=>t.length))*6.9;   // room for the longest label
    const T = (o.title?78:26) + Math.max(...groups.map(g=>g.length))*5.2;
    const W = L + groups.length*CW + 118, H = T + targets.length*CH + 46;
    let s = head(W,H) + titles(o,8);
    const lim = Math.log2(o.maxFold);
    groups.forEach((g,gi)=>{
      const x = L+gi*CW+CW/2;
      s += `<text transform="translate(${x},${T-7}) rotate(-45)" font-size="10.5"
             text-anchor="start" fill="${INK}">${esc(g)}</text>`;
    });
    targets.forEach((t,ti)=>{
      const y = T+ti*CH;
      s += `<text x="${L-8}" y="${(y+CH/2+3.5).toFixed(1)}" font-size="11" text-anchor="end"
             fill="${INK}">${esc(t)}</text>`;
      groups.forEach((g,gi)=>{
        const x = L+gi*CW, sm = M.sum(g,t);
        if(!sm){
          s += `<rect x="${x}" y="${y.toFixed(1)}" width="${CW-2}" height="${(CH-2).toFixed(1)}"
                 fill="${FAINT}"/>`;
          s += `<text x="${(x+CW/2-1).toFixed(1)}" y="${(y+CH/2+3.5).toFixed(1)}" font-size="10"
                 text-anchor="middle" fill="${MUTE}">&#183;</text>`;
          return;
        }
        const f = Math.max(-lim, Math.min(lim, Math.log2(sm.rq)))/lim;
        const c = f<0 ? mix("#3B9AB2","#f7f5f1",1+f) : mix("#f7f5f1","#F21A00",f);
        s += `<rect x="${x}" y="${y.toFixed(1)}" width="${CW-2}" height="${(CH-2).toFixed(1)}"
               fill="${c}"/>`;
        if(sm.single) s += `<rect x="${x}" y="${y.toFixed(1)}" width="${CW-2}"
               height="${(CH-2).toFixed(1)}" fill="none" stroke="${MUTE}"
               stroke-width="1" stroke-dasharray="2 2"/>`;
        if(o.showValues) s += `<text x="${(x+CW/2-1).toFixed(1)}" y="${(y+CH/2+3.5).toFixed(1)}"
               font-size="9.5" text-anchor="middle"
               fill="${Math.abs(f)>0.55?"#fff":INK}">${sm.rq.toFixed(2)}</text>`;
      });
    });
    // scale
    const sx = L+groups.length*CW+18, sy = T, sh = Math.min(targets.length*CH, 150);
    for(let i=0;i<40;i++){
      const f = 1-2*i/39, c = f<0 ? mix("#3B9AB2","#f7f5f1",1+f) : mix("#f7f5f1","#F21A00",f);
      s += `<rect x="${sx}" y="${(sy+i*sh/40).toFixed(1)}" width="13"
             height="${(sh/40+0.6).toFixed(1)}" fill="${c}"/>`;
    }
    s += `<text x="${sx+18}" y="${sy+9}" font-size="9.5" fill="${MUTE}">${o.maxFold}x up</text>`;
    s += `<text x="${sx+18}" y="${(sy+sh/2+3).toFixed(1)}" font-size="9.5" fill="${MUTE}">1</text>`;
    s += `<text x="${sx+18}" y="${(sy+sh).toFixed(1)}" font-size="9.5" fill="${MUTE}">${o.maxFold}x down</text>`;
    s += `<text x="8" y="${H-10}" font-size="9.5" fill="${MUTE}">dashed outline = one plate only &#183; &#183; = not measured</text>`;
    return s + "</svg>";
  }

  /* Time course: RQ against timepoint, one line per sample group, one panel
     per target. Needs a timepoint on EVERY run - a missing one is reported,
     never guessed, because inventing a harvest time would be inventing data. */
  function timeCourse(M, opt){
    const o = Object.assign({ width:1000, panelH:220, title:"", subtitle:"",
      groups:null, targets:null, logY:true }, opt||{});
    const missing = M.plates.filter(p=>p.timepoint == null).map(p=>p.label);
    if(missing.length) return note("No time course: " + missing.length +
      " run(s) have no timepoint (" + missing.slice(0,4).join(", ") +
      "). Set one on every run - it cannot be inferred.");
    const ts = [...new Set(M.plates.map(p=>+p.timepoint))].sort((a,b)=>a-b);
    if(ts.length < 2) return note("No time course: every run shares the same timepoint.");
    const targets = o.targets || M.targets;
    const groups  = (o.groups || M.groups).filter(g => targets.some(t => M.get(g,t).length));
    if(!targets.length || !groups.length) return empty();
    const cols = palette(groups.length);
    const L=66, R=120, T=o.title?82:30, GAP=56, PH=o.panelH, W=o.width;
    const innerW = W-L-R, H = T + targets.length*(PH+GAP) + 40;
    let s = head(W,H) + titles(o,L);
    const xS = v => L + (ts.length===1 ? innerW/2
      : (v-ts[0])/(ts[ts.length-1]-ts[0])*innerW);

    targets.forEach((t,ti)=>{
      const y0 = T+ti*(PH+GAP), y1 = y0+PH;
      const all = groups.flatMap(g=>M.get(g,t).map(c=>c.rq)).filter(v=>isFinite(v)&&v>0);
      if(!all.length) return;
      const top = niceMax(Math.max(1.05, ...all));
      const bot = o.logY ? Math.min(0.5, Math.min(...all)*0.85) : 0;
      const yS = o.logY
        ? v => y1 - (Math.log10(Math.max(v,bot))-Math.log10(bot))/(Math.log10(top)-Math.log10(bot))*PH
        : v => y1 - Math.max(0,Math.min(v,top))/top*PH;
      s += `<text x="${L}" y="${y0-9}" font-size="13" font-weight="600" fill="${INK}">${esc(t)}</text>`;
      s += `<line x1="${L}" y1="${y0}" x2="${L}" y2="${y1}" stroke="${LINE}"/>`;
      s += `<line x1="${L}" y1="${y1}" x2="${L+innerW}" y2="${y1}" stroke="${LINE}"/>`;
      s += `<line x1="${L}" y1="${yS(1).toFixed(1)}" x2="${L+innerW}" y2="${yS(1).toFixed(1)}"
             stroke="${MUTE}" stroke-dasharray="3 3"/>`;
      [bot,1,top].forEach(v=>{ s += `<text x="${L-7}" y="${(yS(v)+3.5).toFixed(1)}" font-size="10"
             text-anchor="end" fill="${MUTE}">${v>=1?v.toFixed(v%1?2:0):v.toFixed(2)}</text>`; });
      ts.forEach(v=>{ s += `<text x="${xS(v).toFixed(1)}" y="${y1+15}" font-size="10.5"
             text-anchor="middle" fill="${INK}">${v} h</text>`; });
      groups.forEach((g,gi)=>{
        const raw = M.get(g,t).filter(c=>c.timepoint!=null && isFinite(c.rq) && c.rq>0);
        if(!raw.length) return;
        /* Several plates can share a timepoint (two 72 h plates, say). Drawing
           a line through each plate makes it double back on itself, so the
           LINE follows the geometric mean at each timepoint while every plate
           keeps its own visible point - the replicate is shown, not hidden. */
        const byT = new Map();
        for(const c of raw){ const k=+c.timepoint;
          if(!byT.has(k)) byT.set(k,[]); byT.get(k).push(c); }
        const path = [...byT.keys()].sort((a,b)=>a-b).map(k=>{
          const v = byT.get(k).map(c=>c.rq);
          return { x:xS(k), y:yS(Math.exp(v.reduce((a,b)=>a+Math.log(b),0)/v.length)) };
        });
        if(path.length>1) s += `<polyline fill="none" stroke="${cols[gi]}" stroke-width="2"
          points="${path.map(p=>p.x.toFixed(1)+","+p.y.toFixed(1)).join(" ")}"/>`;
        /* Spread co-timed plates sideways so they do not sit on top of each other. */
        const pts = [];
        for(const [k,arr] of byT) arr.forEach((c,j)=>{
          const off = (j - (arr.length-1)/2) * (arr.length>1 ? 7 : 0);
          pts.push({ x:xS(k)+off, y:yS(c.rq), c });
        });
        for(const p of pts){
          if(p.c.lo!=null && p.c.hi!=null)
            s += `<line x1="${p.x.toFixed(1)}" y1="${yS(p.c.lo).toFixed(1)}" x2="${p.x.toFixed(1)}"
                   y2="${yS(p.c.hi).toFixed(1)}" stroke="${cols[gi]}" stroke-width="1"/>`;
          s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4"
                 fill="${cols[gi]}" stroke="#fff" stroke-width="1"/>`;
        }
      });
    });
    groups.forEach((g,gi)=>{
      s += `<circle cx="${W-R+14}" cy="${T+12+gi*17}" r="4" fill="${cols[gi]}"/>`;
      s += `<text x="${W-R+24}" y="${T+16+gi*17}" font-size="10.5" fill="${INK}">${esc(g)}</text>`;
    });
    return s + "</svg>";
  }

  /* ---- small shared pieces ---------------------------------------------- */
  function head(W,H){
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"
      viewBox="0 0 ${W} ${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="#fff"/>`;
  }
  function titles(o,x){
    let s="";
    if(o.title) s += `<text x="${x}" y="26" font-size="17" font-weight="600" fill="${INK}">${esc(o.title)}</text>`;
    if(o.subtitle) s += `<text x="${x}" y="46" font-size="11.5" fill="${MUTE}">${esc(o.subtitle)}</text>`;
    return s;
  }
  function axis(L,innerW,y0,y1,top,yS){
    let s = `<line x1="${L}" y1="${y0}" x2="${L}" y2="${y1}" stroke="${LINE}"/>`
          + `<line x1="${L}" y1="${y1}" x2="${L+innerW}" y2="${y1}" stroke="${LINE}"/>`;
    for(let i=0;i<=4;i++){ const v = top*i/4;
      s += `<text x="${L-7}" y="${(yS(v)+3.5).toFixed(1)}" font-size="10" text-anchor="end"
             fill="${MUTE}">${v.toFixed(v<1?2:1)}</text>`;
      if(i) s += `<line x1="${L}" y1="${yS(v).toFixed(1)}" x2="${L+innerW}" y2="${yS(v).toFixed(1)}"
             stroke="${FAINT}"/>`; }
    return s;
  }
  function legend(labels, cols, x, y){
    let s=""; let cx=x;
    labels.forEach((l,i)=>{
      s += `<rect x="${cx}" y="${y-9}" width="11" height="11" fill="${cols[i]}"/>`;
      s += `<text x="${cx+16}" y="${y}" font-size="10.5" fill="${INK}">${esc(l)}</text>`;
      cx += 26 + String(l).length*6.2;
    });
    return s;
  }
  function empty(){ return note("Nothing to plot yet."); }
  function note(msg){
    const w = Math.max(400, msg.length*6.6+24);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="56"><text x="10" y="32"
      font-family="${FONT}" font-size="12" fill="${MUTE}">${esc(msg)}</text></svg>`;
  }
  function mix(a,b,t){
    const A=hex2rgb(a), B=hex2rgb(b);
    return rgb2hex([lerp(A[0],B[0],t),lerp(A[1],B[1],t),lerp(A[2],B[2],t)]);
  }

  return { ZISSOU, palette, rqChart, refChart, svgToPng,
           comboChart, heatmap, timeCourse };
})();
if (typeof module !== "undefined") module.exports = FIG;
