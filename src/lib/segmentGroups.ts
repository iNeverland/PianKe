/**
 * 综艺分段的展示与文本转换。
 *
 * 数据模型：`Progress.segments` 是 `ProgressSegment[]`——**期号与分段名分开存**，
 * 期号是数据，而不是从自由文本里猜出来的约定。这样详情页的分组、日记页的显示、Excel 导出
 * 都直接用期号，不再需要靠后缀重复位置之类的启发式去推断。
 *
 * 早期版本存的是自由文本标签（如「第 3 期加更上」，或只写后缀的「加更上」）。
 * `legacyTextToSegments` 负责把这类旧数据升级成结构化分段（读取时归一化 + 一次性迁移），
 * `parseSegmentText` 负责把用户在输入框里敲的文本解析成结构化分段。
 *
 * 本模块只做纯计算，不读写云端、不碰 React。
 */
import type { ProgressSegment } from '@shared/types/index';

/**
 * 同一期内的观感顺序：上 → 中 → 下 → 加更。
 * 空分段名（尚未命名的空位）必须排在**最后**——新增的分段本身就是空的，
 * 若排在最前，用户每加一块都会看到它插到该期开头。
 */
const SUFFIX_ORDER: Record<string, number> = {
  上: 1,
  中: 2,
  中上: 3,
  中下: 4,
  下: 5,
  加更上: 6,
  加更下: 7,
  '': 99,
};

const CN_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 「第十二期」这类中文数字转阿拉伯数字；纯数字原样返回。 */
function cnNumberToInt(raw: string): number | null {
  // 全角数字先折半角，中文数字按十位规则解析。
  const text = raw.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(text)) return Number(text);
  if (text === '十') return 10;
  if (/^十[一二三四五六七八九]$/.test(text)) return 10 + (CN_DIGITS[text[1]] ?? 0);
  if (/^[一二三四五六七八九]十[一二三四五六七八九]?$/.test(text)) {
    return (CN_DIGITS[text[0]] ?? 0) * 10 + (text.length === 3 ? CN_DIGITS[text[2]] ?? 0 : 0);
  }
  if (text.length === 1 && CN_DIGITS[text] != null) return CN_DIGITS[text];
  return null;
}

/**
 * 归一化分段名里的括号。
 * 「中（上）」必须变成「中上」而不是「中」——中文括号在此是**补充限定**（中·上），
 * 语义在括号里，直接删掉会和「中」撞成一个标签。
 */
function normalizeLabel(text: string): string {
  return text.replace(/[（(]\s*([^）)]*?)\s*[）)]/g, '$1').trim();
}

/** 「第 2 期」「第2期」这类期号的匹配，含中文与全角数字。 */
const PERIOD_PATTERN = /^第\s*([0-9０-９]+|[一二三四五六七八九十]+)\s*[期集]/;

/** 非数字期号（先导片一类）的固定写法。 */
const SIGN_PATTERN = /^(先导片|前瞻|序章)/;

/** 显示用的标准期号文本。 */
function periodText(value: number): string {
  return `第 ${value} 期`;
}

/**
 * 期号里的数字：`第 3 期` → 3。
 * 「先导片」返回 -1（排在各期之前），其他自定义期号返回 null（排在期号之后）。
 */
function periodSortKey(period: string): number | null {
  const text = period.trim();
  if (!text) return null;
  if (SIGN_PATTERN.test(text)) return -1;
  const matched = text.match(PERIOD_PATTERN);
  if (!matched) return null;
  return cnNumberToInt(matched[1]);
}

/** 期号的数值（用于「下一期」与整期改名）；解析不出数字时返回 null。 */
function periodValue(period: string): number | null {
  const matched = period.trim().match(PERIOD_PATTERN);
  if (!matched) return null;
  return cnNumberToInt(matched[1]);
}

/**
 * 把用户输入的文本解析成结构化分段。
 *
 * - 文本自带期号（「第 3 期加更上」「先导片下」）→ 期号归一到标准写法，其余作为分段名；
 * - 只有分段名（「加更上」）→ 期号沿用 `fallbackPeriod`（通常是同一条目上一行的期号，
 *   或编辑时该分段原本所属的期），这正是「一期里只有第一个分段写期号」这一习惯的结构化落地。
 */
export function parseSegmentText(text: string, fallbackPeriod = ''): ProgressSegment {
  const trimmed = text.trim();
  const sign = trimmed.match(SIGN_PATTERN);
  if (sign) return { period: sign[0], label: normalizeLabel(trimmed.slice(sign[0].length)) };

  const episode = trimmed.match(PERIOD_PATTERN);
  if (episode) {
    const value = cnNumberToInt(episode[1]);
    if (value != null) return { period: periodText(value), label: normalizeLabel(trimmed.slice(episode[0].length)) };
  }

  return { period: fallbackPeriod.trim(), label: normalizeLabel(trimmed) };
}

/** 结构化分段还原成一行文本（输入框、aria-label、日记与导出都用它）。 */
export function segmentText(segment: ProgressSegment): string {
  return `${segment.period.trim()}${segment.label.trim()}`.trim();
}

/** 输入框/日记用的完整列表文本。 */
export function segmentsToText(segments: ProgressSegment[]): string {
  return segments.map(segmentText).filter(Boolean).join(' · ');
}

/** 给期号为空的项按**索引距离就近**补上相邻期的期号（只在归一化/升级旧数据时用，不写回）。 */
function fillNearestPeriod(segments: readonly ProgressSegment[]): ProgressSegment[] {
  if (!segments.some((segment) => segment.period.trim())) return [...segments];
  return segments.map((segment, index) => {
    if (segment.period.trim()) return segment;
    let nearest = '';
    let bestDistance = Number.POSITIVE_INFINITY;
    segments.forEach((candidate, i) => {
      if (!candidate.period.trim()) return;
      const distance = Math.abs(i - index);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = candidate.period;
      }
    });
    return nearest ? { ...segment, period: nearest } : segment;
  });
}

/**
 * 旧数据升级：自由文本标签数组 → 结构化分段。
 *
 * 用户常常只给某一期的第一个分段写期号（「第 3 期上」），同期的其余分段只写「下」「加更上」。
 * 这里解析出各自的期号，解析不出期号的按就近规则归入有期号的相邻期——与详情页原有的分组
 * 规则一致，保证升级前后用户看到的归属不变。整份数据都没有期号时期号留空（展示层会原样
 * 显示分段名，不做无依据的编号）。
 */
export function legacyTextToSegments(legacy: readonly string[]): ProgressSegment[] {
  return fillNearestPeriod(legacy.map((text) => parseSegmentText(text)));
}

/**
 * 读取口归一化：把云端存下来的 segments 统一成结构化分段。
 *
 * - 结构化（当前形态）→ 只补缺失字段；
 * - 旧文本标签 `string[]` → `legacyTextToSegments` 升级；
 * - 混排（只可能出现在一次性迁移中途）→ 逐项处理并保持原有顺序；
 * - 不是数组（字段缺失/类型不对）→ 返回 undefined，交由调用方决定是否带该字段。
 */
export function normalizeStoredSegments(raw: unknown): ProgressSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const asSegment = (item: unknown): ProgressSegment => {
    const segment = (item ?? {}) as Partial<ProgressSegment>;
    return {
      period: typeof segment.period === 'string' ? segment.period : '',
      label: typeof segment.label === 'string' ? segment.label : '',
    };
  };

  if (raw.every((item) => item != null && typeof item === 'object')) return raw.map(asSegment);
  if (raw.every((item) => typeof item === 'string')) return legacyTextToSegments(raw as string[]);
  // 混排：逐项处理（结构化项保留、旧文本项解析），再统一按就近规则补期号，顺序不变。
  return fillNearestPeriod(raw.map((item) => (
    item != null && typeof item === 'object' ? asSegment(item) : parseSegmentText(typeof item === 'string' ? item : '')
  )));
}

interface ParsedSegment {
  /** 分组标题，即所处期号；无期号时为「其他」 */
  title: string;
  /** 分组排序键：先导片 -1，第 N 期取 N，其他取极大值排到最后 */
  sortKey: number;
  /** 方块内显示的分段名 */
  label: string;
  /** 完整文本，用于输入框初值与宽度计算 */
  raw: string;
  /** 在 segments 数组中的原始下标（增删改都以此为准） */
  index: number;
  watched: boolean;
}

export interface SegmentGroup {
  id: string;
  title: string;
  sortKey: number;
  items: ParsedSegment[];
}

export interface SegmentGroupOptions {
  /** 是否按期号分组。关闭时退化为单个「其他」组（即平铺）。 */
  groupBySeason?: boolean;
}

/**
 * 把结构化分段整理成「按期分组」的展示结构。
 *
 * 期号直接来自数据；只有期号为空的分段才按索引距离就近归入相邻期（展示层兜底，
 * 不写回数据）。分组按出现顺序输出，组内按上/中/下/加更排序。
 */
export function groupSegments(segments: readonly ProgressSegment[], options: SegmentGroupOptions = {}): SegmentGroup[] {
  const { groupBySeason = true } = options;

  const parsed: ParsedSegment[] = segments.map((segment, index) => {
    const label = segment.label.trim();
    const period = groupBySeason ? segment.period.trim() : '';
    const sortKey = periodSortKey(period);
    return {
      title: period || '其他',
      sortKey: sortKey ?? Number.MAX_SAFE_INTEGER,
      label: groupBySeason ? label : segmentText(segment),
      raw: segmentText(segment),
      index,
      watched: label.length > 0,
    };
  });

  // 期号为空的段：就近归入有期号的相邻期。整份数据都没有期号时保持「其他」。
  if (groupBySeason) {
    parsed.forEach((item, index) => {
      if (item.title !== '其他') return;
      let nearest = '';
      let bestDistance = Number.POSITIVE_INFINITY;
      segments.forEach((segment, i) => {
        const period = segment.period.trim();
        if (!period) return;
        const distance = Math.abs(i - index);
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = period;
        }
      });
      if (nearest) {
        item.title = nearest;
        item.sortKey = periodSortKey(nearest) ?? Number.MAX_SAFE_INTEGER;
      }
    });
  }

  const groups: SegmentGroup[] = [];
  const byTitle = new Map<string, SegmentGroup>();
  for (const item of parsed) {
    let group = byTitle.get(item.title);
    if (!group) {
      group = { id: item.title, title: item.title, sortKey: item.sortKey, items: [] };
      byTitle.set(item.title, group);
      groups.push(group);
    }
    // 同组内排序键取最小（空分段解析不出期号，不能带偏整组的顺序）
    if (item.sortKey < group.sortKey) group.sortKey = item.sortKey;
    group.items.push(item);
  }

  // 同一期内按上/中/下/加更的观感顺序稳定排序；排序只影响展示，增删仍以 index 为准。
  for (const group of groups) {
    group.items.sort((a, b) => {
      const oa = SUFFIX_ORDER[a.label] ?? 99;
      const ob = SUFFIX_ORDER[b.label] ?? 99;
      return oa - ob || a.index - b.index;
    });
  }

  return groups;
}

/** 某分组的已看数（分段名非空即有内容）。 */
export function countWatched(group: SegmentGroup): number {
  return group.items.filter((item) => item.watched).length;
}

/**
 * 整期改名：把 `from` 这一期的所有分段改到 `to`，分段名保持不变。
 *
 * 用于「直接编辑组标题」——改一处，整期跟随，不必逐行改名。
 * `to` 只写数字（「5」）时补成标准写法「第 5 期」，与旧版只让数字可编辑的手感一致。
 */
export function renamePeriod(segments: readonly ProgressSegment[], from: string, to: string): ProgressSegment[] {
  const source = from.trim();
  const target = normalizePeriodText(to);
  if (!source || !target || source === target) return [...segments];
  // 「其他」组是无期号分段的兜底分组：给它改名即等于把这些分段正式归入新期号。
  const matches = (segment: ProgressSegment) => (
    segment.period.trim() === source || (source === '其他' && !segment.period.trim() && target !== '其他')
  );
  return segments.map((segment) => (matches(segment) ? { ...segment, period: target } : segment));
}

/** 期号文本归一化：「5」→「第 5 期」；其他文本（先导片、番外…）原样保留。 */
function normalizePeriodText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const numeric = /^[0-9０-９]+$/.test(trimmed) || /^[一二三四五六七八九十]+$/.test(trimmed);
  if (numeric) {
    const value = cnNumberToInt(trimmed);
    if (value != null && value > 0) return periodText(value);
  }
  return trimmed;
}

/**
 * 生成“下一期”的默认分段：现有最大期号 +1，没有期号时从第 1 期开始。
 *
 * 分段名带 `上`，新一期一添加就能直接落进对应分组，不需要用户先写期号。
 *
 * 已知语义代价：本模型里「已看」等价于「分段名非空」，所以新添加的一期会先显示为
 * **已看**。要根治需要把分段改为 `{ label, watched }` 并做数据迁移。
 */
export function nextPeriodSegment(segments: readonly ProgressSegment[]): ProgressSegment {
  let max = 0;
  for (const segment of segments) {
    const value = periodValue(segment.period);
    if (value != null && value > max) max = value;
  }
  return { period: periodText(max + 1), label: '上' };
}

/**
 * 给「只写了分段名、没写期号」的日记文本补回期号（只读展示用，不改动任何数据）。
 *
 * 只在展示**旧日记**时才需要：新写入的日记本身就带期号（见 cloudApi 的
 * upsertVarietyProgressDiary）。旧日记里存的是当时的分段名，本函数把它与
 * `segments`（已结构化，期号明确）对齐后补全：
 *
 * - 期号取自详情页同一套分组结果，因此日记显示的期号与详情页所见一致；
 * - 同分段名跨期重复时（每期都有「加更上」），按出现顺序认领更靠前、尚未被认领的那一项
 *   （分段排列顺序就是观看顺序）；
 * - 已有期号的文本原样返回；匹配不上或该分段没有期号时也原样返回，不硬凑。
 */
export function qualifyVarietySegments(tokens: readonly string[], segments: readonly ProgressSegment[]): string[] {
  if (segments.length === 0) return [...tokens];

  const periods: string[] = new Array(segments.length).fill('');
  const labels: string[] = new Array(segments.length).fill('');
  const sortKeys: number[] = new Array(segments.length).fill(Number.MAX_SAFE_INTEGER);
  for (const group of groupSegments(segments)) {
    for (const item of group.items) {
      periods[item.index] = group.title === '其他' ? '' : group.title;
      labels[item.index] = item.label;
      sortKeys[item.index] = item.sortKey;
    }
  }

  const parsed = tokens.map((token) => parseSegmentText(token));
  const consumed = segments.map(() => false);
  const result = [...tokens];

  /** 认领最靠前的、尚未被认领的匹配分段；找不到返回 -1。 */
  const claim = (label: string, sortKey?: number): number => {
    const index = labels.findIndex((item, i) => (
      !consumed[i] && item === label && periods[i] !== '' && (sortKey == null || sortKeys[i] === sortKey)
    ));
    if (index >= 0) consumed[index] = true;
    return index;
  };

  // 第一遍：文本自带期号的标签先各就各位——它们没有歧义，先占位就不会被前面的裸标签抢走。
  parsed.forEach((own) => {
    if (!own.period) return;
    claim(own.label, periodSortKey(own.period) ?? Number.MAX_SAFE_INTEGER);
  });

  // 第二遍：只写了分段名的标签，按出现顺序认领剩下的同名分段（顺序即观看顺序）。
  parsed.forEach((own, i) => {
    if (own.period) return;
    const index = claim(own.label);
    if (index >= 0) result[i] = `${periods[index]}${tokens[i]}`;
  });

  return result;
}
