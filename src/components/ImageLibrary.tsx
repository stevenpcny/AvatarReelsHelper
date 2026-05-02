import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, ChevronRight, ChevronLeft, AlertCircle, RefreshCcw, Download } from 'lucide-react';
import {
  saveDirHandle, loadDirHandle, clearDirHandle,
  ensureReadPermission, loadImagesFromDir, revokeImageUrls,
  INTERNAL_IMAGE_MIME, exportMatchedImages,
  type LoadedImage,
  type MatchMap,
} from '../utils/imageMatch';

interface AuditRow { id: string }

interface Props {
  matchMap: MatchMap;
  onImagesLoaded: (imgs: LoadedImage[]) => void;
  auditResults: AuditRow[];
  fileByName: Record<string, LoadedImage>;
}

export function ImageLibrary({ matchMap, onImagesLoaded, auditResults, fileByName }: Props) {
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [images, setImages] = useState<LoadedImage[]>([]);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<any>(null);

  const refCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const filename of Object.values(matchMap)) {
      counts[filename] = (counts[filename] ?? 0) + 1;
    }
    return counts;
  }, [matchMap]);

  // Load persisted dir handle on mount; if permission already granted, auto-load images.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handle = await loadDirHandle();
      if (!handle || cancelled) return;
      handleRef.current = handle;
      const state = await ensureReadPermission(handle, false);
      if (state === 'granted') {
        try {
          const imgs = await loadImagesFromDir(handle);
          if (cancelled) { revokeImageUrls(imgs); return; }
          setImages(imgs);
          onImagesLoaded(imgs);
        } catch (e: any) {
          setError(e?.message ?? '读取目录失败');
        }
      } else {
        setNeedsPermission(true);
      }
    })();
    return () => { cancelled = true; };
    // onImagesLoaded is stable enough; don't refire on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke object URLs on unmount
  useEffect(() => () => revokeImageUrls(images), [images]);

  const pickFolder = async () => {
    setError(null);
    try {
      const picker = (window as any).showDirectoryPicker;
      if (!picker) {
        setError('当前浏览器不支持文件夹选择，请使用 Chrome/Edge。');
        return;
      }
      const handle = await picker({ id: 'arh-images', mode: 'read' });
      handleRef.current = handle;
      await saveDirHandle(handle);
      const imgs = await loadImagesFromDir(handle);
      revokeImageUrls(images);
      setImages(imgs);
      setNeedsPermission(false);
      onImagesLoaded(imgs);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message ?? '选择目录失败');
    }
  };

  const grantPermission = async () => {
    if (!handleRef.current) return;
    const state = await ensureReadPermission(handleRef.current, true);
    if (state === 'granted') {
      try {
        const imgs = await loadImagesFromDir(handleRef.current);
        revokeImageUrls(images);
        setImages(imgs);
        setNeedsPermission(false);
        onImagesLoaded(imgs);
      } catch (e: any) {
        setError(e?.message ?? '读取目录失败');
      }
    }
  };

  const reload = async () => {
    if (!handleRef.current) return;
    try {
      const imgs = await loadImagesFromDir(handleRef.current);
      revokeImageUrls(images);
      setImages(imgs);
      onImagesLoaded(imgs);
    } catch (e: any) {
      setError(e?.message ?? '刷新目录失败');
    }
  };

  const exportSorted = async () => {
    if (!handleRef.current || exporting) return;
    setExportMsg(null);
    const items = auditResults
      .map(r => {
        const name = matchMap[r.id];
        const img = name ? fileByName[name] : undefined;
        return img ? { id: r.id, file: img.file } : null;
      })
      .filter((x): x is { id: string; file: File } => x !== null);
    if (items.length === 0) {
      setExportMsg('没有已匹配的图片可导出');
      return;
    }
    const state = await ensureReadPermission(handleRef.current, true);
    if (state !== 'granted') {
      setExportMsg('需要文件夹写入权限');
      return;
    }
    setExporting(true);
    try {
      const res = await exportMatchedImages(handleRef.current, items);
      setExportMsg(`已导出 ${res.exported} 张到 ${res.subfolderName}/`);
    } catch (e: any) {
      setExportMsg(e?.message ?? '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const forget = async () => {
    revokeImageUrls(images);
    setImages([]);
    handleRef.current = null;
    await clearDirHandle();
    onImagesLoaded([]);
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-white border border-r-0 border-neutral-200 rounded-l-xl px-2 py-4 shadow-md hover:bg-neutral-50"
        title="展开图片库"
      >
        <ChevronLeft className="w-4 h-4 text-neutral-500" />
      </button>
    );
  }

  return (
    <aside className="fixed right-0 top-0 bottom-0 w-[300px] z-40 bg-white border-l border-neutral-200 shadow-lg flex flex-col">
      <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-bold text-neutral-800">图片库</span>
          {images.length > 0 && (
            <span className="text-[10px] text-neutral-400 font-medium">{images.length} 张</span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 hover:bg-neutral-100 rounded text-neutral-400"
          title="收起"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-2 border-b border-neutral-100 flex flex-wrap gap-2">
        <button
          onClick={pickFolder}
          className="text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
        >
          <FolderOpen className="w-3 h-3" />
          {images.length > 0 ? '更换文件夹' : '选择文件夹'}
        </button>
        {images.length > 0 && (
          <button
            onClick={reload}
            className="text-[11px] font-bold text-neutral-600 hover:bg-neutral-100 px-2 py-1.5 rounded-lg flex items-center gap-1"
            title="刷新目录"
          >
            <RefreshCcw className="w-3 h-3" />
            刷新
          </button>
        )}
        {images.length > 0 && (
          <button
            onClick={exportSorted}
            disabled={exporting}
            className="text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 px-2 py-1.5 rounded-lg flex items-center gap-1"
            title="把已匹配的图片按段落序号导出到子文件夹（无损拷贝）"
          >
            <Download className="w-3 h-3" />
            {exporting ? '导出中…' : '导出排序图片'}
          </button>
        )}
        {handleRef.current && (
          <button
            onClick={forget}
            className="text-[11px] font-bold text-red-500 hover:bg-red-50 px-2 py-1.5 rounded-lg"
            title="忘记目录"
          >
            清除
          </button>
        )}
      </div>

      {needsPermission && (
        <div className="m-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 space-y-2">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertCircle className="w-3.5 h-3.5" />
            需要重新授权访问之前选择的文件夹
          </div>
          <button
            onClick={grantPermission}
            className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-bold"
          >
            授权访问
          </button>
        </div>
      )}

      {error && (
        <div className="m-3 p-2 bg-red-50 border border-red-100 rounded-lg text-[11px] text-red-700">
          {error}
        </div>
      )}

      {exportMsg && (
        <div className="mx-3 mb-2 p-2 bg-emerald-50 border border-emerald-100 rounded-lg text-[11px] text-emerald-700">
          {exportMsg}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {images.length === 0 && !needsPermission && !error && (
          <div className="text-center text-[11px] text-neutral-400 mt-12 px-4">
            选择本地图片文件夹后，从这里把图片拖到左侧文案上完成匹配。
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <div
              key={img.name}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(INTERNAL_IMAGE_MIME, img.name);
                e.dataTransfer.setData('text/plain', img.name);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className="group relative rounded-lg overflow-hidden border border-neutral-200 hover:border-blue-400 hover:shadow-md transition-all cursor-grab active:cursor-grabbing bg-neutral-50"
              title={img.name}
            >
              <img
                src={img.url}
                alt={img.name}
                draggable={false}
                className="w-full h-[120px] object-cover pointer-events-none"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1">
                <div className="text-[9px] font-bold text-white truncate">{img.name}</div>
              </div>
              {refCount[img.name] > 0 && (
                <div className="absolute top-1 right-1 bg-blue-600 text-white text-[9px] font-black rounded-full px-1.5 py-0.5 shadow">
                  ×{refCount[img.name]}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
