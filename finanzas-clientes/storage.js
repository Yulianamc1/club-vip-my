const DB_VERSION = 1;
const STORES = ["settings", "movements", "catalog", "meta"];

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

export async function createFinanceStore(userId) {
  const fingerprint = await hashIdentity(userId);
  const databaseName = `myvip_finance_client_v1_${fingerprint.slice(0, 24)}`;
  const database = await openDatabase(databaseName);

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

  async function put(name, value) {
    const { transaction, store } = openStore(name, "readwrite");
    store.put(value);
    await transactionDone(transaction);
    return value;
  }

  async function remove(name, id) {
    const { transaction, store } = openStore(name, "readwrite");
    store.delete(id);
    await transactionDone(transaction);
  }

  async function replaceAll(snapshot) {
    const transaction = database.transaction(STORES, "readwrite");
    for (const name of STORES) transaction.objectStore(name).clear();
    for (const item of snapshot.settings || []) transaction.objectStore("settings").put(item);
    for (const item of snapshot.movements || []) transaction.objectStore("movements").put(item);
    for (const item of snapshot.catalog || []) transaction.objectStore("catalog").put(item);
    for (const item of snapshot.meta || []) transaction.objectStore("meta").put(item);
    await transactionDone(transaction);
  }

  async function mergeAll(snapshot) {
    for (const name of STORES) {
      for (const incoming of snapshot[name] || []) {
        const current = await get(name, incoming.id);
        const incomingUpdated = String(incoming.updatedAt || incoming.createdAt || "");
        const currentUpdated = String(current?.updatedAt || current?.createdAt || "");
        if (!current || incomingUpdated >= currentUpdated) await put(name, incoming);
      }
    }
  }

  async function snapshot() {
    const [settings, movements, catalog, meta] = await Promise.all(
      STORES.map((name) => getAll(name)),
    );
    return { settings, movements, catalog, meta };
  }

  return {
    fingerprint,
    get,
    getAll,
    put,
    remove,
    replaceAll,
    mergeAll,
    snapshot,
    close: () => database.close(),
  };
}
