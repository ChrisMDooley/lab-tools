/* ============================================================================
   notebook.js  -  a running lab-book log inside an experiment folder.

     experiments/<ID>/
       notebook/
         2026-11-15T1536-first-transfection.md
         attachments/3f9a1c....png

   An entry is a MARKDOWN FILE, not a row in a database. Open the folder in
   ten years with no browser and the record is still legible: text in .md
   files, images as ordinary .png beside them. That is the whole point of a
   notebook you would otherwise keep on paper.

   Images are written once and addressed by the SHA-256 of their bytes, so
   pasting the same gel into four entries stores it once and a corrupted copy
   is detectable. Everything lands in the experiment's manifest like any other
   file.

   Entries are freely editable and deletable - no counter-signing, no locked
   records. But every edit bumps `edited` and keeps the previous text in
   notebook/.history/, because a lab book that silently rewrites itself is
   worth less than the paper one it replaced. History is cheap: plain text.

   Exposes a global: NOTEBOOK
   ========================================================================= */
var NOTEBOOK = (function(){
  "use strict";

  const DIR = "notebook";
  const ATT = DIR + "/attachments";
  const HIST = DIR + "/.history";

  const pad = n => String(n).padStart(2,"0");
  /* Seconds, not just minutes. Two entries written in the same minute is an
     ordinary thing to do, and at minute resolution they would sort equal and,
     with the same title, overwrite each other outright. */
  function stamp(d){
    return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate())
         + "T" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  async function exists(vfs, path){
    try{ await vfs.stat(path); return true; }catch(e){ return false; }
  }
  const slug = s => String(s||"").toLowerCase().replace(/[^\w]+/g,"-")
    .replace(/^-+|-+$/g,"").slice(0,48) || "entry";

  /* ---- frontmatter ------------------------------------------------------- */
  /* A tiny key: value block. Not YAML - just enough to carry the fields, and
     readable by a human with a text editor, which is the test that matters. */
  function compose(e){
    const esc = v => String(v==null?"":v).replace(/\n/g," ");
    const L = ["---",
      "title: "   + esc(e.title),
      "author: "  + esc(e.author),
      "created: " + esc(e.created),
      "edited: "  + esc(e.edited || ""),
      "status: "  + esc(e.status || ""),
      "tags: "    + (Array.isArray(e.tags) ? e.tags.join(", ") : esc(e.tags)),
      "---", ""];
    return L.join("\n") + String(e.body == null ? "" : e.body).replace(/\s*$/,"") + "\n";
  }
  function parse(text, path){
    const s = String(text).replace(/\r\n?/g,"\n");
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(s);
    const e = { path, title:"", author:"", created:"", edited:"", status:"", tags:[], body:s };
    if(m){
      for(const line of m[1].split("\n")){
        const k = /^(\w+):\s*(.*)$/.exec(line);
        if(!k) continue;
        if(k[1] === "tags") e.tags = k[2].split(",").map(x=>x.trim()).filter(Boolean);
        else if(k[1] in e) e[k[1]] = k[2];
      }
      e.body = s.slice(m[0].length);
    }
    if(!e.created){                    // fall back to the filename's own stamp
      const f = /(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})?/.exec(path||"");
      if(f) e.created = f[1] + "T" + f[2] + ":" + f[3] + (f[4] ? ":"+f[4] : "");
    }
    return e;
  }

  /* ---- listing and reading ----------------------------------------------- */
  async function list(vfs, id){
    const base = BUNDLE.dir(id) + "/" + DIR;
    let names = [];
    try{ names = (await vfs.listDir(base)).filter(x=>x.kind==="file" && /\.md$/i.test(x.name))
                                          .map(x=>x.name); }catch(e){ return []; }
    const out = [];
    for(const n of names.sort()){
      try{
        const e = parse(await VFS.readText(vfs, base + "/" + n), DIR + "/" + n);
        e.file = n;
        e.preview = MD.toText(e.body).slice(0,160);
        out.push(e);
      }catch(err){ out.push({ file:n, path:DIR+"/"+n, title:n, error:String(err.message||err) }); }
    }
    return out.sort((a,b)=>String(b.created||"").localeCompare(String(a.created||"")));
  }
  async function read(vfs, id, file){
    const e = parse(await VFS.readText(vfs, BUNDLE.dir(id) + "/" + DIR + "/" + file), DIR + "/" + file);
    e.file = file; return e;
  }

  /* ---- writing ------------------------------------------------------------ */
  async function create(vfs, id, entry){
    const now = new Date();
    const e = Object.assign({ title:"", author:"", status:"", tags:[], body:"" }, entry||{});
    e.created = e.created || now.toISOString().slice(0,19);
    e.edited = "";
    /* Even with seconds, never write over an entry that is already there:
       losing a notebook page to a name collision is not an acceptable
       failure mode. */
    let file = stamp(now) + "-" + slug(e.title) + ".md", n = 1;
    while(await exists(vfs, BUNDLE.dir(id) + "/" + DIR + "/" + file))
      file = stamp(now) + "-" + slug(e.title) + "-" + (++n) + ".md";
    await vfs.writeFile(BUNDLE.dir(id) + "/" + DIR + "/" + file, compose(e));
    await BUNDLE.remanifest(vfs, id, "");
    return Object.assign({}, e, { file, path: DIR + "/" + file });
  }

  /* Rewrites the entry, keeping the superseded text under .history/ first.
     Not an audit trail and does not pretend to be one - it is the safety net
     that makes a wrong edit recoverable. */
  async function update(vfs, id, file, patch){
    const base = BUNDLE.dir(id);
    const before = await read(vfs, id, file);
    const prev = compose(before);
    const now = new Date();
    await vfs.writeFile(base + "/" + HIST + "/" + file.replace(/\.md$/,"") +
                        "." + stamp(now) + ".md", prev);
    const e = Object.assign({}, before, patch, { created: before.created,
                                                 edited: now.toISOString().slice(0,19) });
    await vfs.writeFile(base + "/" + DIR + "/" + file, compose(e));
    await BUNDLE.remanifest(vfs, id, "");
    return Object.assign(e, { file, path: DIR + "/" + file });
  }

  /* Deletion is allowed outright, as asked - but the text goes to .history/
     rather than evaporating, so "deleted the wrong one" is survivable. */
  async function remove(vfs, id, file){
    const base = BUNDLE.dir(id);
    try{
      const prev = await VFS.readText(vfs, base + "/" + DIR + "/" + file);
      await vfs.writeFile(base + "/" + HIST + "/" + file.replace(/\.md$/,"") +
                          ".deleted-" + stamp(new Date()) + ".md", prev);
    }catch(e){}
    await vfs.remove(base + "/" + DIR + "/" + file);
    await BUNDLE.remanifest(vfs, id, "");
    return { ok:true, file };
  }

  async function history(vfs, id, file){
    const stem = file.replace(/\.md$/,"");
    try{
      return (await vfs.listDir(BUNDLE.dir(id) + "/" + HIST))
        .filter(x=>x.kind==="file" && x.name.indexOf(stem + ".") === 0)
        .map(x=>x.name).sort().reverse();
    }catch(e){ return []; }
  }

  /* ---- attachments -------------------------------------------------------- */
  /* Content-addressed: the same gel pasted into four entries is stored once,
     and the name is a fact about the bytes rather than a guess at a title. */
  async function attach(vfs, id, bytes, ext){
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hash = await BUNDLE.sha256(u8);
    const name = hash.slice(0,16) + "." + String(ext||"png").replace(/[^\w]/g,"").toLowerCase();
    /* Two different paths, and confusing them silently breaks every image:
         path  - what goes in the Markdown, relative to the entry file, which
                 lives in notebook/ alongside attachments/
         full  - where it is written, relative to the experiment folder
       MD.safeUrl only accepts the first form, so an entry that referenced
       "notebook/attachments/x.png" would render as inert text, not a picture. */
    const path = "attachments/" + name;
    const full = BUNDLE.dir(id) + "/" + ATT + "/" + name;
    let exists = false;
    try{ await vfs.stat(full); exists = true; }catch(e){}
    if(!exists){ await vfs.writeFile(full, u8); await BUNDLE.remanifest(vfs, id, ""); }
    return { path, name, storedAt: ATT + "/" + name, bytes:u8.length, reused:exists, sha256:hash };
  }

  /* An entry's markdown says attachments/<name>; the page is not served from
     the folder, so each reference is turned into a blob URL for display. */
  async function resolveImages(vfs, id, html){
    const urls = [];
    const out = await replaceAsync(html, /src="(attachments\/[\w.-]+)"/g, async (m, rel)=>{
      try{
        const bytes = await vfs.readFile(BUNDLE.dir(id) + "/" + DIR + "/" + rel);
        const ext = (rel.split(".").pop()||"png").toLowerCase();
        const type = ext==="svg" ? "image/svg+xml" : ext==="jpg" ? "image/jpeg" : "image/"+ext;
        const u = URL.createObjectURL(new Blob([bytes], {type}));
        urls.push(u);
        return `src="${u}"`;
      }catch(e){ return `src="" data-missing="${rel}" alt="missing attachment"`; }
    });
    return { html: out, urls };
  }
  async function replaceAsync(str, re, fn){
    const parts = [], src = String(str); let last = 0, m;
    re.lastIndex = 0;
    while((m = re.exec(src)) !== null){
      parts.push(src.slice(last, m.index), await fn(...m));
      last = m.index + m[0].length;
      if(m[0] === "") re.lastIndex++;
    }
    parts.push(src.slice(last));
    return parts.join("");
  }

  /* ---- search across experiments ------------------------------------------ */
  async function search(vfs, q){
    const needle = String(q||"").toLowerCase().trim();
    if(!needle) return [];
    const hits = [];
    for(const exp of await BUNDLE.list(vfs)){
      for(const e of await list(vfs, exp.id)){
        const hay = ((e.title||"") + " " + (e.tags||[]).join(" ") + " " +
                     MD.toText(e.body||"")).toLowerCase();
        const at = hay.indexOf(needle);
        if(at < 0) continue;
        hits.push({ experiment:exp.id, experimentName:exp.name, file:e.file,
                    title:e.title, created:e.created,
                    context: hay.slice(Math.max(0,at-50), at+110).trim() });
      }
    }
    return hits.sort((a,b)=>String(b.created||"").localeCompare(String(a.created||"")));
  }

  return { DIR, ATT, HIST, list, read, create, update, remove, history,
           attach, resolveImages, search, compose, parse, _slug:slug, _stamp:stamp };
})();
if (typeof module !== "undefined") module.exports = NOTEBOOK;
