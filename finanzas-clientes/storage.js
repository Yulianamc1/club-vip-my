const DB_VERSION = 1;
const STORES = ["settings", "movements", "catalog", "meta"];
const SYNC_META_ID = "cloud-sync";
const LEGACY_SYNC_META_IDS = ["cloud-sync-v195", "cloud-sync-v194"];
const TOMBSTONE_PREFIX = "tombstone:";
const LEGACY_TOMBSTONE_PREFIXES = ["tombstone:v195:", "tombstone:v194:"];
const SYNC_DEBOUNCE_MS = 900;
const SYNC_MAX_RETRIES = 2;

function fallbackHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function hashIdentity(value) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error("MISSING_USER_ID");
  if (!globalThis.crypto?.subtle) return fallbackHash(normalized);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`myvip-finance-account:${normalized}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("STORAGE_ERROR"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("STORAGE_ABORTED"));
    transaction.onerror = () => reject(transaction.error || new Error("STORAGE_ERROR"));
  });
}

async function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("movements")) {
        const store = database.createObjectStore("movements", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
      if (!database.objectStoreNames.contains("catalog")) {
        const store = database.createObjectStore("catalog", { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("STORAGE_OPEN_ERROR"));
    request.onblocked = () => reject(new Error("STORAGE_BLOCKED"));
  });
}

function normalizedSnapshot(snapshot = {}) {
  return {
    settings: Array.isArray(snapshot.settings) ? snapshot.settings : [],
    movements: Array.isArray(snapshot.movements) ? snapshot.movements : [],
    catalog: Array.isArray(snapshot.catalog) ? snapshot.catalog : [],
    meta: Array.isArray(snapshot.meta) ? snapshot.meta : [],
  };
}

function timestampOf(item) {
  const raw = item?.updatedAt || item?.deletedAt || item?.createdAt || item?.closedAt || item?.reopenedAt || "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function businessDataCount(snapshot) {
  const s = normalizedSnapshot(snapshot);
  return s.settings.length + s.movements.length + s.catalog.length + s.meta.filter((x) => { const id=String(x?.id || ""); const isTomb=[TOMBSTONE_PREFIX,...LEGACY_TOMBSTONE_PREFIXES].some((p)=>id.startsWith(p)); return !isTomb && id !== SYNC_META_ID && !LEGACY_SYNC_META_IDS.includes(id); }).length;
}

function tombstoneId(store, id) {
  return `${TOMBSTONE_PREFIX}${store}:${String(id)}`;
}

function parseTombstone(item) {
  if (!item || typeof item !== "object") return null;
  const tid = String(item.id || "");
  if (![TOMBSTONE_PREFIX, ...LEGACY_TOMBSTONE_PREFIXES].some((prefix) => tid.startsWith(prefix))) return null;
  const store = String(item.store || "");
  const targetId = String(item.targetId || "");
  if (!STORES.includes(store) || store === "meta" || !targetId) return null;
  return { store, targetId, deletedAt: String(item.deletedAt || item.updatedAt || ""), ts: timestampOf(item) };
}

function mergeCollection(a, b) {
  const map = new Map();
  for (const item of [...(a || []), ...(b || [])]) {
    if (!item || item.id == null) continue;
    const key = String(item.id);
    const current = map.get(key);
    if (!current || timestampOf(item) >= timestampOf(current)) map.set(key, item);
  }
  return [...map.values()];
}

function mergeSnapshots(localRaw, remoteRaw) {
  const local = normalizedSnapshot(localRaw);
  const remote = normalizedSnapshot(remoteRaw);
  const merged = {
    settings: mergeCollection(local.settings, remote.settings),
    movements: mergeCollection(local.movements, remote.movements),
    catalog: mergeCollection(local.catalog, remote.catalog),
    meta: mergeCollection(local.meta, remote.meta),
  };

  const tombstones = new Map();
  for (const item of merged.meta) {
    const t = parseTombstone(item);
    if (!t) continue;
    const key = `${t.store}:${t.targetId}`;
    const current = tombstones.get(key);
    if (!current || t.ts >= current.ts) tombstones.set(key, t);
  }

  for (const [key, t] of tombstones) {
    const items = merged[t.store] || [];
    const found = items.find((item) => String(item?.id) === t.targetId);
    if (!found || t.ts >= timestampOf(found)) {
      merged[t.store] = items.filter((item) => String(item?.id) !== t.targetId);
    } else {
      // Si el elemento fue recreado/modificado después de la eliminación, el tombstone ya no domina.
      merged.meta = merged.meta.filter((item) => String(item?.id) !== tombstoneId(t.store, t.targetId));
    }
  }
  return merged;
}

function syncContext() {
  const ctx = globalThis.MYVIP_FINANCE_CONTEXT || {};
  const codigo = String(ctx.codigo || "").trim().toUpperCase();
  const whatsapp = String(ctx.whatsapp || "").replace(/\D/g, "").slice(-10);
  const authenticated = ctx.authenticated === true;
  if (!authenticated && (!codigo || whatsapp.length !== 10)) return null;
  return { codigo, whatsapp, authenticated };
}

async function rpc(name, args) {
  const cfg = globalThis.MYVIP_FINANCE_SYNC_CONFIG || {};
  if (cfg.client && typeof cfg.client.rpc === "function") {
    const result = await cfg.client.rpc(name, args);
    if (result?.error) throw new Error(result.error.message || "SYNC_RPC_ERROR");
    return result?.data ?? null;
  }
  const url = String(cfg.url || "https://ncdppxdkxfduypvscexy.supabase.co").replace(/\/$/, "");
  const key = String(cfg.key || "sb_publishable_eDOs8qIBNohDID0Co6kK9w_Yaufm5yS");
  let token = key;
  if (typeof cfg.getAccessToken === "function") {
    try { token = String((await cfg.getAccessToken()) || key); } catch (_) { token = key; }
  }
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(args),
    cache: "no-store",
    credentials: "omit",
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(`SYNC_HTTP_${response.status}`);
  return data;
}

export async function createFinanceStore(userId) {
  const fingerprint = await hashIdentity(userId);
  const databaseName = `myvip_finance_client_v1_${fingerprint.slice(0, 24)}`;
  const database = await openDatabase(databaseName);
  let closed = false;
  let syncTimer = null;
  let syncPromise = null;
  let lastRevision = 0;
  let lastRemoteUpdatedAt = null;
  let lastSyncError = "";

  function openStore(name, mode = "readonly") {
    if (!STORES.includes(name)) throw new Error("INVALID_STORE");
    const transaction = database.transaction(name, mode);
    return { transaction, store: transaction.objectStore(name) };
  }

  async function get(name, id) {
    return resultOf(openStore(name).store.get(id));
  }

  async function getAll(name) {
    return resultOf(openStore(name).store.getAll());
  }

  async function rawPut(name, value) {
    const { transaction, store } = openStore(name, "readwrite");
    store.put(value);
    await transactionDone(transaction);
    return value;
  }

  async function rawRemove(name, id) {
    const { transaction, store } = openStore(name, "readwrite");
    store.delete(id);
    await transactionDone(transaction);
  }

  async function localSnapshot() {
    const [settings, movements, catalog, meta] = await Promise.all(
      STORES.map((name) => getAll(name)),
    );
    return { settings, movements, catalog, meta };
  }

  async function writeSnapshot(snapshot) {
    const safe = normalizedSnapshot(snapshot);
    const transaction = database.transaction(STORES, "readwrite");
    for (const name of STORES) transaction.objectStore(name).clear();
    for (const item of safe.settings) transaction.objectStore("settings").put(item);
    for (const item of safe.movements) transaction.objectStore("movements").put(item);
    for (const item of safe.catalog) transaction.objectStore("catalog").put(item);
    for (const item of safe.meta) transaction.objectStore("meta").put(item);
    await transactionDone(transaction);
  }

  async function readSyncMeta() {
    let meta = await get("meta", SYNC_META_ID);
    if (!meta) {
      for (const legacyId of LEGACY_SYNC_META_IDS) {
        meta = await get("meta", legacyId);
        if (meta) break;
      }
    }
    lastRevision = Math.max(0, Number(meta?.revision || 0));
    lastRemoteUpdatedAt = meta?.remoteUpdatedAt || null;
    return meta || null;
  }

  async function saveSyncMeta(extra = {}) {
    const now = new Date().toISOString();
    const meta = {
      id: SYNC_META_ID,
      revision: lastRevision,
      remoteUpdatedAt: lastRemoteUpdatedAt,
      lastSyncAt: now,
      lastError: lastSyncError,
      updatedAt: now,
      ...extra,
    };
    await rawPut("meta", meta);
    return meta;
  }

  function snapshotForCloud(snapshot) {
    const safe = normalizedSnapshot(snapshot);
    // El metadato de transporte local no necesita viajar; los tombstones sí.
    return {
      settings: safe.settings,
      movements: safe.movements,
      catalog: safe.catalog,
      meta: safe.meta.filter((item) => item?.id !== SYNC_META_ID && !LEGACY_SYNC_META_IDS.includes(String(item?.id || ""))),
    };
  }

  async function pushSnapshot(snapshot, baseRevision, attempt = 0) {
    const ctx = syncContext();
    if (!ctx) return { ok: false, skipped: true, reason: "no-session-context" };
    const payload = snapshotForCloud(snapshot);
    const result = await rpc("vip_finanzas_sync_guardar", {
      p_codigo: ctx.codigo,
      p_whatsapp: ctx.whatsapp,
      p_snapshot: payload,
      p_base_revision: baseRevision,
    });
    if (result?.ok === true) {
      lastRevision = Math.max(0, Number(result.revision || 0));
      lastRemoteUpdatedAt = result.updated_at || null;
      lastSyncError = "";
      await saveSyncMeta();
      return { ok: true, revision: lastRevision };
    }
    if (result?.conflict === true && attempt < SYNC_MAX_RETRIES) {
      const local = await localSnapshot();
      const merged = mergeSnapshots(local, result.snapshot || {});
      await writeSnapshot({
        ...merged,
        meta: mergeCollection(merged.meta, [{
          id: SYNC_META_ID,
          revision: Number(result.revision || 0),
          remoteUpdatedAt: result.updated_at || null,
          updatedAt: new Date().toISOString(),
        }]),
      });
      lastRevision = Math.max(0, Number(result.revision || 0));
      lastRemoteUpdatedAt = result.updated_at || null;
      return pushSnapshot(await localSnapshot(), lastRevision, attempt + 1);
    }
    throw new Error("SYNC_SAVE_REJECTED");
  }

  async function syncNow({ pullFirst = false } = {}) {
    if (closed) return { ok: false, skipped: true, reason: "closed" };
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      try {
        const ctx = syncContext();
        if (!ctx) return { ok: false, skipped: true, reason: "no-session-context" };
        await readSyncMeta();
        const local = await localSnapshot();
        const remote = await rpc("vip_finanzas_sync_obtener", {
          p_codigo: ctx.codigo,
          p_whatsapp: ctx.whatsapp,
        });
        if (remote?.ok !== true) throw new Error("SYNC_READ_REJECTED");
        const remoteRevision = Math.max(0, Number(remote.revision || 0));
        const remoteSnapshot = normalizedSnapshot(remote.snapshot || {});

        if (remoteRevision === 0) {
          if (businessDataCount(local) > 0) return await pushSnapshot(local, 0);
          lastRevision = 0;
          lastRemoteUpdatedAt = null;
          lastSyncError = "";
          await saveSyncMeta();
          return { ok: true, revision: 0, empty: true };
        }

        if (businessDataCount(local) === 0) {
          lastRevision = remoteRevision;
          lastRemoteUpdatedAt = remote.updated_at || null;
          const remoteWithMeta = {
            ...remoteSnapshot,
            meta: mergeCollection(remoteSnapshot.meta, [{
              id: SYNC_META_ID,
              revision: remoteRevision,
              remoteUpdatedAt: lastRemoteUpdatedAt,
              updatedAt: new Date().toISOString(),
            }]),
          };
          await writeSnapshot(remoteWithMeta);
          return { ok: true, revision: remoteRevision, pulled: true };
        }

        if (remoteRevision !== lastRevision || pullFirst) {
          const merged = mergeSnapshots(local, remoteSnapshot);
          lastRevision = remoteRevision;
          lastRemoteUpdatedAt = remote.updated_at || null;
          await writeSnapshot({
            ...merged,
            meta: mergeCollection(merged.meta, [{
              id: SYNC_META_ID,
              revision: remoteRevision,
              remoteUpdatedAt: lastRemoteUpdatedAt,
              updatedAt: new Date().toISOString(),
            }]),
          });
          return await pushSnapshot(await localSnapshot(), remoteRevision);
        }

        return await pushSnapshot(local, lastRevision);
      } catch (error) {
        lastSyncError = String(error?.message || error || "SYNC_ERROR").slice(0, 180);
        try { await saveSyncMeta(); } catch (_) {}
        // Offline-first: un fallo de red nunca bloquea el uso local de Finanzas.
        return { ok: false, offline: true, error: lastSyncError };
      } finally {
        syncPromise = null;
      }
    })();
    return syncPromise;
  }

  function scheduleSync() {
    if (closed || !syncContext()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, SYNC_DEBOUNCE_MS);
  }

  async function put(name, value) {
    const result = await rawPut(name, value);
    if (name !== "meta" && value?.id != null) {
      const tid = tombstoneId(name, value.id);
      const tomb = await get("meta", tid);
      if (tomb && timestampOf(value) >= timestampOf(tomb)) await rawRemove("meta", tid);
    }
    scheduleSync();
    return result;
  }

  async function remove(name, id) {
    if (!STORES.includes(name) || name === "meta") {
      await rawRemove(name, id);
      scheduleSync();
      return;
    }
    const now = new Date().toISOString();
    const transaction = database.transaction([name, "meta"], "readwrite");
    transaction.objectStore(name).delete(id);
    transaction.objectStore("meta").put({
      id: tombstoneId(name, id),
      store: name,
      targetId: String(id),
      deletedAt: now,
      updatedAt: now,
    });
    await transactionDone(transaction);
    scheduleSync();
  }

  async function replaceAll(snapshot) {
    await writeSnapshot(snapshot);
    scheduleSync();
  }

  async function mergeAll(snapshot) {
    const merged = mergeSnapshots(await localSnapshot(), snapshot);
    await writeSnapshot(merged);
    scheduleSync();
  }

  async function snapshot() {
    return localSnapshot();
  }

  // Gate DIAMANTE: intenta reconciliar nube/local antes de que la UI lea datos.
  // Si no hay internet, continúa local sin borrar ni bloquear información.
  await syncNow({ pullFirst: true });

  const periodic = setInterval(() => {
    if (!closed && !document.hidden) syncNow({ pullFirst: true }).catch(() => {});
  }, 60000);
  const onVisibility = () => {
    if (!document.hidden) syncNow({ pullFirst: true }).catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    fingerprint,
    get,
    getAll,
    put,
    remove,
    replaceAll,
    mergeAll,
    snapshot,
    syncNow,
    syncStatus: () => ({ revision: lastRevision, remoteUpdatedAt: lastRemoteUpdatedAt, lastError: lastSyncError }),
    close: () => {
      closed = true;
      clearTimeout(syncTimer);
      clearInterval(periodic);
      document.removeEventListener("visibilitychange", onVisibility);
      database.close();
    },
  };
}
