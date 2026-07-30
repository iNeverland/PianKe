import { useState, useRef, useCallback, useEffect } from 'react';

interface CropOverlayProps {
  imageDataUrl: string;
  onCancel: () => void;
  onCrop: (rect: { x: number; y: number; w: number; h: number }) => void;
}

export default function CropOverlay({ imageDataUrl, onCancel, onCrop }: CropOverlayProps) {
  const [dragging, setDragging] = useState(false);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // ESC 取消
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const getPos = useCallback((e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pos = getPos(e);
    startRef.current = pos;
    setRect(null);
    setDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const pos = getPos(e);
    const x = Math.min(startRef.current.x, pos.x);
    const y = Math.min(startRef.current.y, pos.y);
    const w = Math.abs(pos.x - startRef.current.x);
    const h = Math.abs(pos.y - startRef.current.y);
    if (w > 4 || h > 4) {
      setRect({ x, y, w, h });
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  const handleConfirm = () => {
    if (rect && rect.w > 10 && rect.h > 10) {
      onCrop(rect);
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[300] select-none cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* 背景：全屏截图 */}
      <img src={imageDataUrl} alt="" className="absolute inset-0 w-full h-full object-contain bg-black" draggable={false} />

      {/* 暗色遮罩（选区外变暗） */}
      {rect && (
        <>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute border-2 border-accent bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          />
        </>
      )}

      {/* 拖拽中或无选区时的提示 */}
      {!rect && !dragging && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center pointer-events-none">
          <span className="text-white/80 text-sm">拖拽鼠标选择截图区域，按 ESC 取消</span>
        </div>
      )}

      {/* 操作栏 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 rounded-lg px-3 py-2 z-10">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10 text-sm border-none bg-transparent cursor-pointer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          取消 (ESC)
        </button>
        <button
          onClick={handleConfirm}
          disabled={!rect || rect.w < 10 || rect.h < 10}
          className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-accent text-white hover:brightness-110 text-sm font-semibold border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>
          确认截图
        </button>
      </div>
    </div>
  );
}
