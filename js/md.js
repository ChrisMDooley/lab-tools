/* ============================================================================
   md.js  -  a small, safe Markdown renderer.

   Deliberately not a library. A notebook entry needs headings, emphasis,
   lists, tables, images, links, quotes, rules and code - and nothing else.
   Everything is HTML-escaped FIRST and markup is then rebuilt from the escaped
   text, so a pasted <script> or an onerror= attribute from a Word document is
   inert by construction rather than by a blacklist that can be got round.

   Image and link targets are whitelisted: attachments/..., http(s): and
   data:image only. That stops a pasted javascript: URL from becoming a live
   link in a lab record.

   Exposes a global: MD
   ========================================================================= */
var MD = (function(){
  "use strict";

  const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  /* Only these may appear in href/src. Anything else renders as plain text,
     so the record still SHOWS what was written - it just is not clickable. */
  function safeUrl(u){
    const s = String(u||"").trim();
    if(/^attachments\/[\w.-]+$/i.test(s)) return s;
    if(/^https?:\/\//i.test(s)) return s;
    if(/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return s;
    return null;
  }

  /* ---- inline ------------------------------------------------------------ */
  function inline(t){
    let s = esc(t);
    // code first: its contents must not be touched by the rules below
    const code = [];
    s = s.replace(/`([^`]+)`/g, (m,c)=>{ code.push(c); return "\u0000C"+(code.length-1)+"\u0000"; });
    // images before links - the syntax differs by one character
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m,alt,url,title)=>{
      const u = safeUrl(url); if(!u) return esc(m);
      return `<img src="${u}" alt="${alt}"${title?` title="${title}"`:""} loading="lazy">`;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m,txt,url)=>{
      const u = safeUrl(url); if(!u) return esc(m);
      return `<a href="${u}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
         .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
         .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
         .replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\u0000C(\d+)\u0000/g, (m,i)=>`<code>${code[+i]}</code>`);
    return s;
  }

  /* ---- block ------------------------------------------------------------- */
  function render(src){
    const lines = String(src==null?"":src).replace(/\r\n?/g,"\n").split("\n");
    const out = [];
    let i = 0;

    const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
    const cells = l => l.replace(/^\s*\|/,"").replace(/\|\s*$/,"").split("|").map(c=>c.trim());

    while(i < lines.length){
      const l = lines[i];

      if(!l.trim()){ i++; continue; }

      // fenced code
      if(/^```/.test(l)){
        const body = [];
        i++;
        while(i<lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
        continue;
      }
      // horizontal rule
      if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){ out.push("<hr>"); i++; continue; }
      // heading
      const h = /^(#{1,4})\s+(.*)$/.exec(l);
      if(h){ const n=h[1].length; out.push(`<h${n+2}>${inline(h[2])}</h${n+2}>`); i++; continue; }
      // table: a header row followed by a separator row
      if(l.includes("|") && i+1<lines.length && isTableSep(lines[i+1])){
        const head = cells(l); i += 2;
        const body = [];
        while(i<lines.length && lines[i].includes("|") && lines[i].trim()) body.push(cells(lines[i++]));
        out.push(`<table><thead><tr>${head.map(c=>`<th>${inline(c)}</th>`).join("")}</tr></thead>`
          + `<tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }
      // blockquote
      if(/^\s*>\s?/.test(l)){
        const body=[];
        while(i<lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/,""));
        out.push(`<blockquote>${render(body.join("\n"))}</blockquote>`);
        continue;
      }
      // lists, including [ ] / [x] task items
      if(/^\s*([-*+]|\d+[.)])\s+/.test(l)){
        const ordered = /^\s*\d+[.)]\s+/.test(l);
        const items = [];
        while(i<lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])){
          let t = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/,"");
          const task = /^\[([ xX])\]\s+/.exec(t);
          if(task){ t = t.slice(task[0].length);
            items.push(`<li class="task"><input type="checkbox" disabled${
              task[1].toLowerCase()==="x"?" checked":""}> ${inline(t)}</li>`); }
          else items.push(`<li>${inline(t)}</li>`);
        }
        out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
        continue;
      }
      // paragraph: consume until a blank line or the start of another block
      const para = [];
      while(i<lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])
            && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])
            && !(lines[i].includes("|") && i+1<lines.length && isTableSep(lines[i+1])))
        para.push(lines[i++]);
      if(para.length) out.push(`<p>${inline(para.join("\n")).replace(/\n/g,"<br>")}</p>`);
      else i++;
    }
    return out.join("\n");
  }

  /* ---- paste helpers ----------------------------------------------------- */
  /* A spreadsheet puts tab-separated text on the clipboard. Turning that into
     a Markdown table is the difference between pasting results and retyping
     them. Only treated as a table when every line has the same column count
     and there is more than one column, so ordinary prose with a stray tab is
     left alone. */
  function tsvToTable(text){
    const rows = String(text).replace(/\r\n?/g,"\n").replace(/\n+$/,"").split("\n")
      .filter(r=>r.length).map(r=>r.split("\t"));
    if(rows.length < 2 || rows[0].length < 2) return null;
    if(!rows.every(r=>r.length === rows[0].length)) return null;
    const esc2 = c => String(c).replace(/\|/g,"\\|").trim();
    const head = rows[0].map(esc2);
    const body = rows.slice(1).map(r=>r.map(esc2));
    return "| " + head.join(" | ") + " |\n"
         + "| " + head.map(()=> "---").join(" | ") + " |\n"
         + body.map(r=>"| " + r.join(" | ") + " |").join("\n") + "\n";
  }

  /* Plain-text extraction, for search and for a preview line. */
  function toText(src){
    return String(src==null?"":src)
      .replace(/```[\s\S]*?```/g," ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g," [image] ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")
      .replace(/[#>*_`~|-]/g," ")
      .replace(/\s+/g," ").trim();
  }

  return { render, inline, toText, tsvToTable, safeUrl, _esc:esc };
})();
if (typeof module !== "undefined") module.exports = MD;
