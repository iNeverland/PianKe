import { useCallback, useEffect, useRef, useState } from 'react';

interface ZoomableImageProps {
  src: string;
  alt?: string;
  maxScale?: number;
  minScale?: number;
}

/**
 * 支持鼠标滚轮缩放 + 拖拽平移的灯箱大图。
 *
 * 关键：图片用 max-width/max-height 以"完整显示"的天然尺寸渲染（不强行撑满弹层），
 * 因此滚轮缩放缩放的是整张图片元素本身——整体变大，超出视口后再拖拽平移查看细节。
 */
export default function ZoomableImage({ src, alt = '', maxScale = 12, minScale = 1 }: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const stateRef = useRef({ scale: 1, x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ clientX: 0, clientY: 0, x: 0, y: 0 });

  const commit = useCallback((nextScale: number, x: number, y: number) => {
    stateRef.current = { scale: nextScale, x, y };
    setScale(nextScale);
    setTranslate({ x, y });
  }, []);

  // 缩到接近 1x 时把平移归零，避免图片偏离中心、留下难看的空边。
  const commitClamped = useCallback((nextScale: number, x: number, y: number) => {
    if (nextScale <= 1.05) {
      commit(nextScale, 0, 0);
    } else {
      commit(nextScale, x, y);
    }
  }, [commit]);

  // React 的 onWheel 以 passive 模式监听，无法 preventDefault 阻止页面滚动，
  // 因此必须用原生事件并以 { passive: false } 挂载。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const { scale: cur, x: curX, y: curY } = stateRef.current;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const next = Math.min(maxScale, Math.max(minScale, cur * factor));
      if (next === cur) return;
      // 以鼠标位置为中心：保持鼠标下方的图像点不动
      const localX = (mouseX - rect.width / 2 - curX) / cur;
      const localY = (mouseY - rect.height / 2 - curY) / cur;
      commitClamped(next, mouseX - rect.width / 2 - localX * next, mouseY - rect.height / 2 - localY * next);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [maxScale, minScale, commitClamped]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stateRef.current.scale <= 1) return; // 未放大时不拖拽，允许点击弹层交互
    e.preventDefault();
    draggingRef.current = true;
    dragStartRef.current = { clientX: e.clientX, clientY: e.clientY, x: stateRef.current.x, y: stateRef.current.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const { clientX, clientY, x, y } = dragStartRef.current;
    commit(stateRef.current.scale, x + (e.clientX - clientX), y + (e.clientY - clientY));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const handleDoubleClick = () => commit(1, 0, 0);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
        userSelect: 'none',
        cursor: stateRef.current.scale > 1 ? 'grab' : 'zoom-in',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={handleDoubleClick}
    >
      <img
        src={src}
        alt={alt}
        decoding="async"
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          willChange: 'transform',
          transition: draggingRef.current ? 'none' : 'transform 0.08s ease-out',
        }}
      />
    </div>
  );
}
