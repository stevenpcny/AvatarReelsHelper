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

export interface ExportItem {
  id: string;
  file: File;
}

export interface ExportResult {
  exported: number;
  skipped: number;
  subfolderName: string;
}

function pad2Plus(n: number, width: number): string {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function timestampFolderName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `for-heygen-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function extOf(filename: string): string {
  const m = filename.match(/\.[^.]+$/);
  return m ? m[0] : '';
}

/**
 * Lossless export: writes the original File blob byte-for-byte into a fresh
 * subfolder under `dirHandle`. Filenames are zero-padded numeric ids preserving
 * the original extension. Strict paragraph alignment: gaps in ids stay as gaps.
 */
export async function exportMatchedImages(
  dirHandle: any,
  items: ExportItem[],
): Promise<ExportResult> {
  const subfolderName = timestampFolderName();
  const sub = await dirHandle.getDirectoryHandle(subfolderName, { create: true });

  const numericIds = items
    .map(it => Number(it.id))
    .filter(n => Number.isFinite(n));
  const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 0;
  const width = Math.max(2, String(maxId).length);

  let exported = 0;
  let skipped = 0;
  for (const it of items) {
    const n = Number(it.id);
    if (!Number.isFinite(n)) { skipped++; continue; }
    const name = `${pad2Plus(n, width)}${extOf(it.file.name)}`;
    const fh = await sub.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(it.file);
    await w.close();
    exported++;
  }
  return { exported, skipped, subfolderName };
}
