const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif";
const SEGMENT_INPUT_FONT = `12px ${FONT_STACK}`;
let measureContext: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext || typeof document === 'undefined') return measureContext;
  measureContext = document.createElement('canvas').getContext('2d');
  return measureContext;
}

/**
 * 量出「输入框里要装下这段文字」所需的宽度。
 *
 * 渲染前量不到真实布局，所以用 canvas 按同样的字体量文本宽度，再补上内边距与光标空间。
 * 量不到（无 DOM 的环境）时退回按字符估算，宁可宽一点也不能截断刚输入的内容。
 *
 * 之所以按字体分别量：期号（0.72rem 粗体）与分段方块（12px）字号不同，
 * 用同一个字号估算会让长期号被吃掉尾字——而期号现在是完全自由的文本。
 */
function measureInputWidth(text: string, font: string, padding: number, min: number, fallbackPerChar: number): string {
  const context = getMeasureContext();
  if (!context) return `${Math.max(min, Math.ceil(text.length * fallbackPerChar + padding * 2))}px`;
  context.font = font;
  return `${Math.max(min, Math.ceil(context.measureText(text).width + padding))}px`;
}

/** 按综艺进度分段方块的真实字体与内边距计算宽度。 */
export function getSegmentInputWidth(label: string): string {
  return measureInputWidth(label || '#0', SEGMENT_INPUT_FONT, 36, 48, 12);
}

/**
 * 期号输入框宽度：跟随文字长度增长。
 * 期号是自由文本（先导片、特别篇、SP1…），固定宽度会截断，所以这里按实际字体量。
 */
export function getPeriodInputWidth(period: string): string {
  // 0.72rem = 11.52px；:hover / :focus 只改颜色，字重保持继承的 600。
  return measureInputWidth(period || '期', `600 11.52px ${FONT_STACK}`, 14, 26, 8);
}
