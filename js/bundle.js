/* ============================================================================
   bundle.js  -  experiments as self-describing folders on disk.

   The principle the whole platform rests on: FILES ARE THE SOURCE OF TRUTH.
   Any index or database is derived and can be thrown away and rebuilt. So a
   bundle has to be readable in ten years without this code:

     experiments/<ID>/
       transfection.json    the plan: doses, volumes, cells
       plate.json           the plate layout sent to the instrument
       qpcr/run-1.json      an analysis run; a later re-run is run-2, not an edit
       manifest.json        SHA-256 of every file, so corruption is visible
       raw/                 instrument files exactly as they came off the machine
       figures/             generated output
       exports/             what was sent elsewhere, e.g. to the ELN
       .lock.json           present only while someone has it open

   One experiment is one folder, and stages ACCUMULATE in it. A qPCR run three
   weeks later must not rewrite the transfection record it was based on, so
   each stage is its own file and nothing is ever overwritten in place. That is
   what keeps the chain intact: these cells got this dose, went in these wells,
   gave these Cq values.

   experiment.json is the older single-record shape. It is still read, so
   folders written before this change keep working.

   Written against the VFS interface, never the browser API, so all of this is
   exercised by the test suite against an in-memory filesystem.

   Exposes a global: BUNDLE
   ========================================================================= */
var BUNDLE = (function(){
  "use strict";

  const FORMAT = "lab-tools/bundle-1";
  const ROOT = "experiments";
  const LOCK_STALE_MS = 2 * 60 * 60 * 1000;      // a lock older than this is ignored

  const enc = s => new TextEncoder().encode(s);
  const hex = buf => [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");

  async function sha256(data){
    const bytes = data instanceof Uint8Array ? data : enc(String(data));
    const c = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
    if(!c) throw new Error("No WebCrypto in this context - checksums need a secure context (https or localhost).");
    // Copy into a fresh buffer: a Uint8Array view over a larger buffer would
    // otherwise hash the whole buffer, which is a nasty silent bug.
    return hex(await c.digest("SHA-256", bytes.slice().buffer));
  }

  const dir = id => ROOT + "/" + id;
  const idOf = name => String(name).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "experiment";

  /* ---- records -----------------------------------------------------------
     A record is one stage, at a known path inside the folder. Writing one
     leaves every other file alone and then rebuilds the manifest from what is
     actually on disk, so the checksums can never drift from reality. */
  const LEGACY = "experiment.json";

  async function putRecord(vfs, id, relPath, record, opts){
    const o = Object.assign({ extras:[], appVersion:"" }, opts||{});
    const base = dir(id);
    await VFS.writeJSON(vfs, base + "/" + relPath, record);
    for(const f of o.extras) await vfs.writeFile(base + "/" + f.path, f.data);
    return { id, path:relPath, manifest: await remanifest(vfs, id, o.appVersion) };
  }

  /* Next free qpcr/run-N.json, so a re-run never lands on an earlier one. */
  async function nextRun(vfs, id, prefix){
    const p = prefix || "qpcr/run";
    const d = p.split("/").slice(0,-1).join("/");
    const stem = p.split("/").pop();
    let files = [];
    try{ files = (await vfs.listDir(dir(id) + (d ? "/" + d : ""))).map(e=>e.name); }catch(e){}
    const re = new RegExp("^" + stem.replace(/[.*+?^${}()|[\]\\]/g,"\\$&") + "-(\\d+)\\.json$");
    const n = files.reduce((m,f)=>{ const x=re.exec(f); return x ? Math.max(m, +x[1]) : m; }, 0);
    return p + "-" + (n+1) + ".json";
  }

  /* Every record in the folder, newest shape and legacy alike. */
  async function records(vfs, id){
    const base = dir(id), out = [];
    const paths = [];
    await walk(vfs, base, "", paths);
    for(const rel of paths.sort()){
      if(rel === "manifest.json" || rel === ".lock.json") continue;
      if(!/\.json$/.test(rel)) continue;
      if(/^(raw|figures|exports)\//.test(rel)) continue;
      try{
        const r = await VFS.readJSON(vfs, base + "/" + rel);
        out.push({ path:rel, kind: r.kind || (rel === LEGACY ? "experiment" : rel.replace(/\.json$/,"")),
                   record:r });
      }catch(e){ out.push({ path:rel, error:String(e.message||e) }); }
    }
    /* Workflow order, not alphabetical: a folder should read in the order the
       work happened, so "transfection, plate, qpcr, qpcr" rather than
       "plate, qpcr, qpcr, transfection". Anything unrecognised sorts last. */
    const ORDER = ["experiment","transfection","plate","qpcr"];
    const rank = r => { const i = ORDER.indexOf(String(r.kind).split("/")[0]);
                        return i < 0 ? ORDER.length : i; };
    return out.sort((a,b)=> rank(a)-rank(b) || a.path.localeCompare(b.path));
  }

  /* ---- listing ----------------------------------------------------------- */
  async function list(vfs){
    const out = [];
    for(const e of await vfs.listDir(ROOT)){
      if(e.kind !== "directory") continue;
      const rec = { id:e.name, name:e.name, modified:null, ok:null, locked:false };
      try{
        const all = await records(vfs, e.name);
        rec.stages = all.map(r=>r.kind);
        const main = all.find(r=>r.kind==="transfection") ||
                     all.find(r=>r.kind==="experiment") || all[0];
        const x = (main && main.record) || {};
        rec.name = (x.meta && x.meta.name) || e.name;
        rec.researcher = x.meta && x.meta.researcher;
        rec.kind = x.kind || "experiment";
        rec.runs = all.filter(r=>/^qpcr\//.test(r.path)).length;
        if(!all.length) rec.unreadable = "no records in this folder";
      }catch(err){ rec.unreadable = String(err.message || err); }
      try{
        const m = await VFS.readJSON(vfs, dir(e.name) + "/manifest.json");
        rec.modified = m.written || null; rec.files = (m.files||[]).length;
      }catch(err){}
      rec.locked = !!(await lockState(vfs, e.name)).held;
      out.push(rec);
    }
    return out.sort((a,b)=>String(b.modified||"").localeCompare(String(a.modified||"")));
  }

  /* ---- writing ----------------------------------------------------------- */
  /* extras: [{path:"raw/x.eds", data:Uint8Array|string}] written verbatim.
     The manifest is built from what is actually on disk afterwards, not from
     what we intended to write, so it cannot drift from reality. */
  async function save(vfs, experiment, opts){
    const o = Object.assign({ extras:[], appVersion:"", id:null }, opts||{});
    const id = o.id || idOf((experiment.meta && (experiment.meta.id || experiment.meta.name)) || "experiment");
    const base = dir(id);
    await VFS.writeJSON(vfs, base + "/experiment.json", experiment);
    for(const f of o.extras) await vfs.writeFile(base + "/" + f.path, f.data);
    return { id, manifest: await remanifest(vfs, id, o.appVersion) };
  }

  /* Rebuilt from what is on disk, never from what we meant to write. */
  async function remanifest(vfs, id, appVersion){
    const base = dir(id), files = [];
    await walk(vfs, base, "", files);
    const manifest = { format: FORMAT, id, written: new Date().toISOString(),
                       appVersion: appVersion || "", files: [] };
    for(const rel of files.sort()){
      if(rel === "manifest.json" || rel === ".lock.json") continue;
      const bytes = await vfs.readFile(base + "/" + rel);
      manifest.files.push({ path:rel, bytes:bytes.length, sha256:await sha256(bytes) });
    }
    await VFS.writeJSON(vfs, base + "/manifest.json", manifest);
    return manifest;
  }
  async function walk(vfs, base, rel, out){
    for(const e of await vfs.listDir(rel ? base + "/" + rel : base)){
      const r = rel ? rel + "/" + e.name : e.name;
      if(e.kind === "directory") await walk(vfs, base, r, out);
      else out.push(r);
    }
  }

  /* ---- reading and verifying --------------------------------------------- */
  async function load(vfs, id){
    const base = dir(id);
    const all = await records(vfs, id);
    const pick = k => (all.find(r=>r.kind===k)||{}).record || null;
    const experiment = pick("transfection") || pick("experiment") ||
                       (all[0] && all[0].record) || {};
    let manifest = null, verification = { checked:false };
    try{ manifest = await VFS.readJSON(vfs, base + "/manifest.json"); }catch(e){}
    if(manifest) verification = await verify(vfs, id, manifest);
    return { id, experiment, records:all, manifest, verification,
             plate:(all.find(r=>r.kind==="plate")||{}).record || null,
             qpcr: all.filter(r=>/^qpcr\//.test(r.path)).map(r=>r.record) };
  }

  /* Recompute every hash. A bundle that has been edited outside the app, or
     half-copied, says so instead of being silently trusted. */
  async function verify(vfs, id, manifest){
    const base = dir(id);
    if(!manifest){
      try{ manifest = await VFS.readJSON(vfs, base + "/manifest.json"); }
      catch(e){ return { checked:false, ok:false, reason:"no manifest" }; }
    }
    const changed = [], missing = [];
    for(const f of (manifest.files||[])){
      let bytes;
      try{ bytes = await vfs.readFile(base + "/" + f.path); }
      catch(e){ missing.push(f.path); continue; }
      const h = await sha256(bytes);
      if(h !== f.sha256) changed.push({ path:f.path, expected:f.sha256, actual:h });
    }
    const onDisk = [];
    await walk(vfs, base, "", onDisk);
    const known = new Set((manifest.files||[]).map(f=>f.path));
    const added = onDisk.filter(p => p !== "manifest.json" && p !== ".lock.json" && !known.has(p));
    return { checked:true, ok: !changed.length && !missing.length && !added.length,
             changed, missing, added, written: manifest.written, count:(manifest.files||[]).length };
  }

  /* ---- locking ------------------------------------------------------------
     A shared folder gives multi-user for free, but not concurrent editing.
     Two people saving the same experiment means last-writer-wins and silent
     loss, so a lock file makes the collision visible. This is advisory - a
     convention between copies of this app, not enforcement. It is honest
     about that rather than pretending to be a transaction. */
  async function lockState(vfs, id){
    const p = dir(id) + "/.lock.json";
    try{
      const l = await VFS.readJSON(vfs, p);
      const age = Date.now() - new Date(l.acquired).getTime();
      return { held: age < LOCK_STALE_MS, stale: age >= LOCK_STALE_MS, lock:l, ageMs:age };
    }catch(e){ return { held:false, stale:false, lock:null, ageMs:null }; }
  }
  async function lock(vfs, id, owner){
    const st = await lockState(vfs, id);
    if(st.held && st.lock.owner !== owner)
      return { ok:false, reason:"held by " + st.lock.owner, lock:st.lock };
    const l = { owner: owner || "unknown", acquired: new Date().toISOString(),
                app: "lab-tools" };
    await VFS.writeJSON(vfs, dir(id) + "/.lock.json", l);
    return { ok:true, lock:l };
  }
  async function unlock(vfs, id, owner){
    const st = await lockState(vfs, id);
    if(st.lock && owner && st.lock.owner !== owner) return { ok:false, reason:"not yours" };
    try{ await vfs.remove(dir(id) + "/.lock.json"); }catch(e){}
    return { ok:true };
  }

  /* ---- export for the ELN -------------------------------------------------
     A single self-contained JSON carrying the record and the manifest, so the
     provenance copy in Labfolder is checkable against the folder on disk. */
  async function exportBundle(vfs, id){
    const { experiment, manifest } = await load(vfs, id);
    return { format:"lab-tools/export-1", id,
             exported:new Date().toISOString(), experiment, manifest };
  }
  async function addFile(vfs, id, relPath, data){
    await vfs.writeFile(dir(id) + "/" + relPath, data);
  }

  return { FORMAT, ROOT, LOCK_STALE_MS, LEGACY, sha256, idOf, dir,
           list, save, load, verify, lock, unlock, lockState,
           putRecord, nextRun, records, remanifest,
           exportBundle, addFile };
})();
if (typeof module !== "undefined") module.exports = BUNDLE;
