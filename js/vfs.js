/* ============================================================================
   vfs.js  -  a very small filesystem interface with two implementations:

     VFS.fromHandle(dirHandle)  real folder on disk, File System Access API
     VFS.memory()               in-memory, used by the test suite

   Everything above this layer (bundle.js) is written against the interface,
   never against the browser API. That is what makes the bundle format, the
   checksums and the locking testable without a folder picker, and what would
   let the same code run against a different backend later.

   Paths are always relative, forward-slash separated, no leading slash:
     "experiments/EXP-1/experiment.json"

   Exposes a global: VFS
   ========================================================================= */
var VFS = (function(){
  "use strict";

  const parts = p => String(p).split("/").filter(Boolean);
  const dirname  = p => parts(p).slice(0,-1).join("/");
  const basename = p => parts(p).slice(-1)[0];

  function supported(){
    return typeof window !== "undefined" &&
           typeof window.showDirectoryPicker === "function";
  }

  /* ---------- real folder ------------------------------------------------ */
  function fromHandle(root){
    async function dir(path, create){
      let h = root;
      for(const seg of parts(path)) h = await h.getDirectoryHandle(seg, {create:!!create});
      return h;
    }
    async function fileHandle(path, create){
      const d = await dir(dirname(path), create);
      return d.getFileHandle(basename(path), {create:!!create});
    }
    return {
      kind: "disk",
      name: root.name,
      async listDir(path){
        let d;
        try{ d = await dir(path, false); }catch(e){ return []; }
        const out = [];
        for await (const [name, h] of d.entries()) out.push({ name, kind:h.kind });
        return out.sort((a,b)=>a.name.localeCompare(b.name));
      },
      async exists(path){
        try{ await fileHandle(path, false); return true; }
        catch(e){ try{ await dir(path,false); return true; }catch(_){ return false; } }
      },
      async stat(path){
        const f = await (await fileHandle(path,false)).getFile();
        return { size:f.size, modified:f.lastModified };
      },
      async readFile(path){
        const f = await (await fileHandle(path,false)).getFile();
        return new Uint8Array(await f.arrayBuffer());
      },
      async writeFile(path, data){
        const h = await fileHandle(path, true);
        const w = await h.createWritable();
        await w.write(data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)));
        await w.close();
      },
      async remove(path){
        const d = await dir(dirname(path), false);
        await d.removeEntry(basename(path), { recursive:true });
      }
    };
  }

  /* ---------- in-memory --------------------------------------------------- */
  function memory(seed){
    const files = new Map();           // path -> {data:Uint8Array, modified:number}
    if(seed) for(const k of Object.keys(seed))
      files.set(k, { data:new TextEncoder().encode(seed[k]), modified:Date.now() });
    const enc = d => d instanceof Uint8Array ? d : new TextEncoder().encode(String(d));
    return {
      kind: "memory", name: "(memory)", _files: files,
      async listDir(path){
        const pre = path ? parts(path).join("/") + "/" : "";
        const seen = new Map();
        for(const k of files.keys()){
          if(!k.startsWith(pre)) continue;
          const rest = k.slice(pre.length).split("/");
          seen.set(rest[0], rest.length > 1 ? "directory" : "file");
        }
        return [...seen].map(([name,kind])=>({name,kind}))
                        .sort((a,b)=>a.name.localeCompare(b.name));
      },
      async exists(path){
        if(files.has(path)) return true;
        const pre = parts(path).join("/") + "/";
        for(const k of files.keys()) if(k.startsWith(pre)) return true;
        return false;
      },
      async stat(path){
        const f = files.get(path); if(!f) throw new Error("no such file: "+path);
        return { size:f.data.length, modified:f.modified };
      },
      async readFile(path){
        const f = files.get(path); if(!f) throw new Error("no such file: "+path);
        return f.data;
      },
      async writeFile(path, data){
        files.set(parts(path).join("/"), { data:enc(data), modified:Date.now() });
      },
      async remove(path){
        const p = parts(path).join("/");
        if(files.delete(p)) return;
        const pre = p + "/";
        for(const k of [...files.keys()]) if(k.startsWith(pre)) files.delete(k);
      }
    };
  }

  /* ---------- helpers shared by both -------------------------------------- */
  async function readText(vfs, path){
    return new TextDecoder().decode(await vfs.readFile(path));
  }
  async function readJSON(vfs, path){ return JSON.parse(await readText(vfs, path)); }
  async function writeJSON(vfs, path, obj){
    return vfs.writeFile(path, JSON.stringify(obj, null, 2) + "\n");
  }

  /* ---------- remembering the chosen folder across visits ------------------ */
  /* A directory handle survives in IndexedDB, so the folder is picked once.
     The browser still re-prompts for permission on return - one click, not a
     re-pick - and that prompt is a deliberate part of the design, not a bug. */
  const DB = "labtools", STORE = "handles";
  function idb(){
    return new Promise((ok,bad)=>{
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => bad(r.error);
    });
  }
  async function rememberHandle(key, handle){
    try{
      const db = await idb();
      await new Promise((ok,bad)=>{
        const t = db.transaction(STORE,"readwrite");
        t.objectStore(STORE).put(handle, key);
        t.oncomplete = ok; t.onerror = () => bad(t.error);
      });
      return true;
    }catch(e){ return false; }
  }
  async function recallHandle(key){
    try{
      const db = await idb();
      return await new Promise((ok,bad)=>{
        const t = db.transaction(STORE,"readonly");
        const q = t.objectStore(STORE).get(key);
        q.onsuccess = () => ok(q.result || null);
        q.onerror = () => bad(q.error);
      });
    }catch(e){ return null; }
  }
  async function forgetHandle(key){
    try{
      const db = await idb();
      await new Promise(ok=>{
        const t = db.transaction(STORE,"readwrite");
        t.objectStore(STORE).delete(key); t.oncomplete = ok; t.onerror = ok;
      });
    }catch(e){}
  }
  async function permission(handle, mode){
    if(!handle || !handle.queryPermission) return "granted";
    const opts = { mode: mode || "readwrite" };
    let s = await handle.queryPermission(opts);
    if(s === "granted") return s;
    s = await handle.requestPermission(opts);
    return s;
  }

  return { supported, fromHandle, memory, readText, readJSON, writeJSON,
           rememberHandle, recallHandle, forgetHandle, permission,
           dirname, basename, parts };
})();
if (typeof module !== "undefined") module.exports = VFS;
