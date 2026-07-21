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
    if (entry.name.startsWith('._') || entry.name.startsWith('.')) continue;
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

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Extracts images (and, if present, the first .txt/.tsv as copywriting) from a zip File. */
export async function loadImagesFromZip(
  file: File
): Promise<{ images: LoadedImage[]; copywriting?: string }> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  const out: LoadedImage[] = [];
  let copywriting: string | undefined;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const base = entry.name.split('/').pop() ?? entry.name;
    if (base.startsWith('._') || base.startsWith('.') || entry.name.startsWith('__MACOSX/')) continue;

    const extMatch = base.match(IMAGE_EXT);
    if (extMatch) {
      const ext = extMatch[1].toLowerCase();
      const blob = await entry.async('blob');
      const typed = new File([blob], base, { type: MIME_BY_EXT[ext] ?? blob.type });
      out.push({ name: base, file: typed, url: URL.createObjectURL(typed) });
    } else if (copywriting === undefined && /\.(txt|tsv)$/i.test(base)) {
      copywriting = await entry.async('string');
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { images: out, copywriting };
}

/** Internal mime used to pass an image filename between our own DOM elements. */
export const INTERNAL_IMAGE_MIME = 'application/x-arh-image-name';
