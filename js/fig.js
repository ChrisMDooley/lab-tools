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
  return { ZISSOU, palette, rqChart, refChart, svgToPng };
})();
if (typeof module !== "undefined") module.exports = FIG;
