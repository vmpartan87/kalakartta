export const LS = {
  get(k, d) { try { const v = localStorage.getItem("kk:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("kk:" + k, JSON.stringify(v)); } catch (e) { } }
};
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open("kalakartta", 2);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ["layers", "spots", "catches"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}
async function op(store, mode, fn) {
  try {
    const d = await open();
    return await new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
  } catch (e) { console.warn("IndexedDB", e); return undefined; }
}
export const IDB = {
  get: (s, k) => op(s, "readonly", st => st.get(k)),
  put: (s, k, v) => op(s, "readwrite", st => st.put(v, k)),
  del: (s, k) => op(s, "readwrite", st => st.delete(k)),
  async all(s) {
    try {
      const d = await open();
      return await new Promise((res, rej) => { const out = []; const c = d.transaction(s, "readonly").objectStore(s).openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); }; c.onerror = () => rej(c.error); });
    } catch (e) { return []; }
  }
};
