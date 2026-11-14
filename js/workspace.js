/* ============================================================================
   workspace.js  -  connects the pages to a real folder on disk.

   One folder holds everything: the oligo library, and an experiments/ tree of
   bundles. Point it at a local folder and it is yours; point it at a shared
   institute drive and the lab shares it, with the institute supplying backup,
   access control and jurisdiction. No server, no database, no accounts.

   The folder is chosen once. The handle persists in IndexedDB, so later visits
   need one permission click rather than another trip through the picker.

   Needs the File System Access API: Chrome or Edge. Firefox and Safari both
   decline to implement it, so there WS.supported() is false and the pages fall
   back to manual import and export, which works everywhere.

   Exposes a global: WS
   ========================================================================= */
var WS = (function(){
  "use strict";

  const HKEY = "dataRoot";
  const OWNER_KEY = "labtools.owner";
  let vfs = null, rootHandle = null, listeners = [];

  const supported = () => VFS.supported();
  const connected = () => !!vfs;
  const current   = () => vfs;
  const rootName  = () => vfs ? vfs.name : null;

  function onChange(fn){ listeners.push(fn); }
  function fire(){ listeners.forEach(f=>{ try{ f(); }catch(e){} }); }

  /* Who holds a lock. Not authentication - a label so a colleague knows who
     to go and ask. Stored locally and editable. */
  function owner(){
    try{ return localStorage.getItem(OWNER_KEY) || ""; }catch(e){ return ""; }
  }
  function setOwner(v){ try{ localStorage.setItem(OWNER_KEY, v||""); }catch(e){} fire(); }

  async function connect(){
    if(!supported()) throw new Error(
      "This browser has no File System Access API. Chrome or Edge is needed for folder mode; " +
      "import and export still work here.");
    const h = await window.showDirectoryPicker({ id:"labtools-data", mode:"readwrite" });
    const perm = await VFS.permission(h, "readwrite");
    if(perm !== "granted") throw new Error("Permission to use that folder was not granted.");
    rootHandle = h; vfs = VFS.fromHandle(h);
    await VFS.rememberHandle(HKEY, h);
    fire(); return vfs;
  }

  /* Re-attach silently if the browser still grants permission; otherwise
     report that one click is needed, rather than nagging on every page load. */
  async function restore(){
    if(!supported()) return { state:"unsupported" };
    const h = await VFS.recallHandle(HKEY);
    if(!h) return { state:"none" };
    rootHandle = h;
    let p = "prompt";
    try{ p = await h.queryPermission({ mode:"readwrite" }); }catch(e){ return { state:"none" }; }
    if(p === "granted"){ vfs = VFS.fromHandle(h); fire(); return { state:"connected", name:h.name }; }
    return { state:"needs-permission", name:h.name };
  }
  async function grant(){
    if(!rootHandle) return { state:"none" };
    const p = await VFS.permission(rootHandle, "readwrite");
    if(p !== "granted") return { state:"denied" };
    vfs = VFS.fromHandle(rootHandle); fire();
    return { state:"connected", name:rootHandle.name };
  }
  async function disconnect(){
    vfs = null; rootHandle = null; await VFS.forgetHandle(HKEY); fire();
  }
  /* Test hook: run the whole workflow against an in-memory filesystem. */
  function _use(v){ vfs = v; rootHandle = null; fire(); return vfs; }

  function need(){
    if(!vfs) throw new Error("No data folder connected. Choose one first.");
    return vfs;
  }

  /* ---- the oligo library lives in the folder, not in the app ------------- */
  async function readLibrary(){
    try{ return await VFS.readJSON(need(), "oligos.json"); }catch(e){ return null; }
  }
  async function writeLibrary(lib){ return VFS.writeJSON(need(), "oligos.json", lib); }

  /* ---- experiments -------------------------------------------------------- */
  const listExperiments = () => BUNDLE.list(need());

  async function saveExperiment(experiment, opts){
    const o = Object.assign({ extras:[], appVersion:"", takeLock:true }, opts||{});
    const v = need();
    const id = o.id || BUNDLE.idOf((experiment.meta &&
                 (experiment.meta.id || experiment.meta.name)) || "experiment");
    if(o.takeLock){
      const who = owner() || "unknown";
      const st = await BUNDLE.lockState(v, id);
      if(st.held && st.lock.owner !== who)
        return { ok:false, conflict:true, lock:st.lock,
                 reason:'"'+id+'" is open by '+st.lock.owner+
                        ' (since '+new Date(st.lock.acquired).toLocaleString()+').' };
    }
    const r = await BUNDLE.save(v, experiment, { extras:o.extras, appVersion:o.appVersion, id });
    if(o.takeLock) await BUNDLE.lock(v, id, owner() || "unknown");
    return { ok:true, id:r.id, manifest:r.manifest };
  }
  const openExperiment  = id => BUNDLE.load(need(), id);
  const verifyExperiment= id => BUNDLE.verify(need(), id);
  const releaseExperiment = id => BUNDLE.unlock(need(), id, owner() || "unknown");
  const addFile = (id, rel, data) => BUNDLE.addFile(need(), id, rel, data);

  /* ---- the panel both pages show ----------------------------------------- */
  function panelHTML(state){
    const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>
      ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    if(!supported()) return `<div class="note w"><b>Folder mode needs Chrome or Edge.</b>
      Firefox and Safari do not implement the File System Access API, and have both said they
      will not. Everything else on this page works; use import and export instead.</div>`;
    if(state && state.state === "needs-permission")
      return `<div class="note w"><b>Reconnect to <code>${esc(state.name)}</code>?</b>
        The folder is remembered, but the browser asks again each session.
        <div class="btns" style="margin-top:8px"><button class="p" onclick="WS._grant()">Reconnect</button>
        <button onclick="WS._connect()">Choose a different folder</button></div></div>`;
    if(!connected()) return `<div class="note i"><b>No data folder connected.</b>
      Choose one and experiments are written there as plain folders you can read without this app
      &mdash; and that your institute already backs up.
      <div class="btns" style="margin-top:8px"><button class="p" onclick="WS._connect()">Choose data folder</button></div></div>`;
    return `<div class="note k"><b>Connected to <code>${esc(rootName())}</code>.</b>
      Experiments are written to <code>experiments/</code> inside it.
      <div class="btns" style="margin-top:8px">
        <button onclick="WS._refresh()">Refresh</button>
        <button onclick="WS._disconnect()">Disconnect</button>
      </div></div>`;
  }

  return { supported, connected, current, rootName, owner, setOwner, onChange,
           connect, restore, grant, disconnect, _use,
           readLibrary, writeLibrary,
           listExperiments, saveExperiment, openExperiment, verifyExperiment,
           releaseExperiment, addFile, panelHTML };
})();
if (typeof module !== "undefined") module.exports = WS;
