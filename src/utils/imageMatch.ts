/**
 * IndexedDB helpers for image library:
 * - persists FileSystemDirectoryHandle for the user's image folder
 * - persists copyId -> imageFilename map across sessions
 */

const DB_NAME = 'avatar-reels-helper';
const DB_VERSION = 1;
const STORE = 'kv';
const KEY_DIR_HANDLE = 'imageDirHandle';
const KEY_MATCH_MAP = 'imageMatchMap';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveDirHandle(handle: any): Promise<void> {
  await kvSet(KEY_DIR_HANDLE, handle);
}

export async function loadDirHandle(): Promise<any | undefined> {
  return kvGet(KEY_DIR_HANDLE);
}

export async function clearDirHandle(): Promise<void> {
  await kvSet(KEY_DIR_HANDLE, undefined);
}

export type MatchMap = Record<string, string>;

export async function saveMatchMap(map: MatchMap): Promise<void> {
  await kvSet(KEY_MATCH_MAP, map);
}

export async function loadMatchMap(): Promise<MatchMap> {
  return (await kvGet<MatchMap>(KEY_MATCH_MAP)) ?? {};
}

/** Returns 'granted' | 'denied' | 'prompt'. Asks user if needed (only when {request: true}). */
export async function ensureReadPermission(
  handle: any,
  request: boolean
): Promise<'granted' | 'denied' | 'prompt'> {
  if (!handle?.queryPermission) return 'denied';
  const opts = { mode: 'read' as const };
  let state = await handle.queryPermission(opts);
  if (state === 'granted') return 'granted';
  if (request) state = await handle.requestPermission(opts);
  return state;
}

export interface LoadedImage {
  name: string;
  file: File;
  url: string; // object URL for thumbnail
}

const IMAGE_EXT = /\.(jpe?g|png)$/i;

export async function loadImagesFromDir(handle: any): Promise<LoadedImage[]> {
  const out: LoadedImage[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    if (!IMAGE_EXT.test(entry.name)) continue;
    const file: File = await entry.getFile();
    out.push({ name: entry.name, file, url: URL.createObjectURL(file) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return out;
}

export function revokeImageUrls(images: LoadedImage[]): void {
  for (const img of images) URL.revokeObjectURL(img.url);
}

/** Internal mime used to pass an image filename between our own DOM elements. */
export const INTERNAL_IMAGE_MIME = 'application/x-arh-image-name';
