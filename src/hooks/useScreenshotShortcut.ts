export interface ShortcutConfig {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

const STORAGE_KEY = 'film-log-screenshot-shortcut';

const DEFAULT: ShortcutConfig = {
  ctrl: true,
  shift: true,
  alt: false,
  meta: false,
  key: 's',
};

export function getShortcutConfig(): ShortcutConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 简单校验结构
      if (
        typeof parsed.ctrl === 'boolean' &&
        typeof parsed.shift === 'boolean' &&
        typeof parsed.alt === 'boolean' &&
        typeof parsed.meta === 'boolean' &&
        typeof parsed.key === 'string' &&
        parsed.key.length === 1
      ) {
        return parsed;
      }
    }
  } catch { /* 格式错误回退默认 */ }
  return { ...DEFAULT };
}

export function saveShortcutConfig(config: ShortcutConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** 使用物理键位，避免 macOS 按住 Option 后将字母转换成特殊字符。 */
export function getShortcutKey(event: Pick<KeyboardEvent, 'code'>): string | null {
  const letter = event.code.match(/^Key([A-Z])$/);
  if (letter) return letter[1].toLowerCase();

  const digit = event.code.match(/^Digit([0-9])$/);
  return digit ? digit[1] : null;
}

/** 将 ShortcutConfig 序列化为 Electron accelerator 字符串，如 "Ctrl+Shift+S" */
export function toAccelerator(config: ShortcutConfig): string {
  const isMacOS = window.electronAPI?.platform === 'darwin';
  const mods: string[] = [];
  if (config.ctrl) mods.push('Ctrl');
  if (config.shift) mods.push('Shift');
  if (config.alt) mods.push(isMacOS ? 'Option' : 'Alt');
  if (config.meta) mods.push(isMacOS ? 'Command' : 'Meta');
  mods.push(config.key.toUpperCase());
  return mods.join('+');
}

/** 返回符合当前系统习惯的快捷键显示文本。 */
export function toDisplayText(config: ShortcutConfig): string {
  const platform = window.electronAPI?.platform;
  const isMacOS = platform === 'darwin';
  const parts: string[] = [];
  if (config.ctrl) parts.push('Ctrl');
  if (config.shift) parts.push('Shift');
  if (config.alt) parts.push(isMacOS ? '⌥ Option' : 'Alt');
  if (config.meta) parts.push(isMacOS ? '⌘ Command' : platform === 'win32' ? 'Win' : 'Meta');
  parts.push(config.key.toUpperCase());
  return parts.join(' + ');
}

/** 判断某个按键组合是否与给定配置匹配 */
export function matchShortcut(e: KeyboardEvent, config: ShortcutConfig): boolean {
  return (
    e.ctrlKey === config.ctrl &&
    e.shiftKey === config.shift &&
    e.altKey === config.alt &&
    e.metaKey === config.meta &&
    e.key.toLowerCase() === config.key.toLowerCase()
  );
}

export function getDefaultConfig(): ShortcutConfig {
  return { ...DEFAULT };
}
