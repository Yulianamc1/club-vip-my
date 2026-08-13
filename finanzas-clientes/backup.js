const FORMAT = "MYVIP_FINANZAS_ENCRYPTED";
const VERSION = 1;
const ITERATIONS = 250000;
const AAD = new TextEncoder().encode("MYVIP_FINANZAS_RESPALDO_V1");

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveKey(password, salt, usages) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function requireCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error("CRYPTO_UNAVAILABLE");
}

export async function createEncryptedBackup({ snapshot, password, fingerprint }) {
  requireCrypto();
  if (String(password || "").length < 6) throw new Error("PASSWORD_TOO_SHORT");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ["encrypt"]);
  const payload = {
    format: "MYVIP_FINANZAS_DATA",
    version: VERSION,
    accountFingerprint: fingerprint,
    createdAt: new Date().toISOString(),
    snapshot,
  };
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return {
    format: FORMAT,
    version: VERSION,
    encryption: "AES-GCM-256",
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  };
}

export async function readEncryptedBackup(file, password) {
  requireCrypto();
  let container;
  try {
    container = JSON.parse(await file.text());
  } catch {
    throw new Error("INVALID_BACKUP");
  }
  if (container?.format !== FORMAT || container?.version !== VERSION) {
    throw new Error("INVALID_BACKUP");
  }
  try {
    const salt = base64ToBytes(container.salt);
    const iv = base64ToBytes(container.iv);
    const key = await deriveKey(password, salt, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      key,
      base64ToBytes(container.data),
    );
    const payload = JSON.parse(new TextDecoder().decode(plain));
    if (payload?.format !== "MYVIP_FINANZAS_DATA" || !payload?.snapshot) {
      throw new Error("INVALID_BACKUP");
    }
    return payload;
  } catch (error) {
    if (error?.message === "INVALID_BACKUP") throw error;
    throw new Error("WRONG_PASSWORD");
  }
}

export function downloadBackup(container, businessName = "Mi-negocio") {
  const cleanName = String(businessName || "Mi-negocio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "Mi-negocio";
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(container)], {
    type: "application/vnd.myvip.finanzas+json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `Respaldo-Finanzas-${cleanName}-${date}.myfinanzas`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
