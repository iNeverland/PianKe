const SEGMENT_INPUT_FONT = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif";
let measureContext: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext || typeof document === 'undefined') return measureContext;
  measureContext = document.createElement('canvas').getContext('2d');
  return measureContext;
}

/** 按综艺进度输入框的真实字体与内边距计算宽度。 */
export function getSegmentInputWidth(label: string): string {
  const context = getMeasureContext();
  const content = label || '#0';
  let textWidth = 24;

  if (context) {
    context.font = SEGMENT_INPUT_FONT;
    textWidth = context.measureText(content).width;
  }

  // 左右 padding 28px，额外预留光标与边框空间，避免尾字被截断。
  return `${Math.max(48, Math.ceil(textWidth + 36))}px`;
}
