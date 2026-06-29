// Offline video downloads via IndexedDB blob storage.
// Preview-safe: no service worker, no caches API. Videos play from
// object URLs created from stored blobs so they keep working without data.

const DB_NAME = "jagx_offline";
const STORE = "videos";
const META_KEY = "jagx_offline_meta_v1";

export type OfflineMeta = {
  id: string;
  title: string;
  size: number;
  user_id: string;
  username?: string | null;
  thumb?: string | null;
  saved_at: number;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function listOffline(): OfflineMeta[] {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveMeta(list: OfflineMeta[]) {
  localStorage.setItem(META_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("jagx-offline-changed"));
}

export async function isDownloaded(id: string) {
  return listOffline().some((m) => m.id === id);
}

export async function downloadVideo(meta: Omit<OfflineMeta, "saved_at" | "size">, url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, meta.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // Also seed the service worker "offline-videos" cache so the regular
  // <video src={remote_url}> request resolves with no network.
  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open("offline-videos");
      await cache.put(url, new Response(blob, {
        headers: { "Content-Type": blob.type || "video/mp4" },
      }));
    }
  } catch { /* cache API unavailable */ }
  const list = listOffline().filter((m) => m.id !== meta.id);
  list.unshift({ ...meta, size: blob.size, saved_at: Date.now() });
  saveMeta(list);
}

export async function getOfflineUrl(id: string): Promise<string | null> {
  try {
    const db = await openDB();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

export async function removeOffline(id: string) {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  saveMeta(listOffline().filter((m) => m.id !== id));
}

export async function clearOffline() {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  saveMeta([]);
}

export function totalOfflineBytes(): number {
  return listOffline().reduce((a, m) => a + (m.size || 0), 0);
}