/**
 * 综艺分段的展示分组。
 *
 * 综艺的进度是用户自由录入的标签（如「先导片上」「第二期加更下」），云端只存字符串数组，
 * 不便也无必要为分组改数据模型。这里在**纯展示层**把标签里已经存在的「季/期」结构解析出来：
 * 标题行显示「第 2 期 · 5/6」，方块内只留「上 / 中 / 下 / 加更上」等后缀，
 * 从而把动辄四五行的长标签收拢成紧凑的分组。
 *
 * 解析不出结构的标签一律归入「其他」并保持原始顺序，不会丢数据。
 */

/**
 * 同一期内的观感顺序：上 → 中 → 下 → 加更。
 * 空后缀（尚未命名的空位）必须排在**最后**——新增的分段本身就是空标签，
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
 * 归一化后缀里的括号。
 * 「中（上）」必须变成「中上」而不是「中」——中文括号在此是**补充限定**（中·上），
 * 语义在括号里，直接删掉会和「中」撞成一个标签。
 */
function normalizeSuffix(text: string): string {
  return text.replace(/[（(]\s*([^）)]*?)\s*[）)]/g, '$1').trim();
}

/** 「第 2 期」「第2期」这类期号的匹配，含中文与全角数字。 */
const PERIOD_PATTERN = /^第\s*([0-9０-９]+|[一二三四五六七八九十]+)\s*[期集]/;

/**
 * 重命名整期：把该期所有行标签里的期号统一改成 `next`，保留各自的后缀。
 *
 * 用于「直接编辑组标题里的数字」——改一处，整期跟随，不必逐行改名。
 * 与标签结构无关的行（解析不出期号，或没有后缀）不会被改动，避免误伤
 * 用户自定义名称。
 */
export function renamePeriod(segments: string[], periodNumber: number, next: number): string[] {
  const from = cnNumberToInt(String(periodNumber));
  if (from == null || !Number.isFinite(next) || next <= 0) return segments;
  return segments.map((segment) => {
    const text = segment.trim();
    const matched = text.match(PERIOD_PATTERN);
    if (!matched) return segment;
    const value = cnNumberToInt(matched[1]);
    if (value == null || value !== from) return segment;
    const suffix = text.slice(matched[0].length).trim();
    // 只有期号、没有后缀的行保持原样，改名后仍与同期末尾项同组。
    return suffix ? `第 ${next} 期${suffix}` : segment;
  });
}

interface ParsedSegment {
  /** 分组标题，如「先导片」「第 2 期」「其他」 */
  title: string;
  /** 分组排序键：先导片 -1，第 N 期取 N，其他取极大值排到最后 */
  sortKey: number;
  /** 方块内显示的后缀 */
  label: string;
  /** 原始标签，用于输入框初值与宽度计算 */
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
  /** 是否按季/期标题分组。关闭时退化为单个「其他」组（即平铺）。 */
  groupBySeason?: boolean;
}

/** 解析单个标签属于哪一期、后缀是什么。 */
function parseSegment(raw: string, index: number): ParsedSegment {
  const text = raw.trim();
  const watched = text.length > 0;
  const base: ParsedSegment = { title: '其他', sortKey: Number.MAX_SAFE_INTEGER, label: normalizeSuffix(text), raw, index, watched };

  if (!text) return base;

  const sign = text.match(/^(先导片|前瞻|序章)/);
  if (sign) {
    const rest = text.slice(sign[0].length);
    return { ...base, title: sign[0], sortKey: -1, label: normalizeSuffix(rest) };
  }

  const episode = text.match(PERIOD_PATTERN);
  if (episode) {
    const value = cnNumberToInt(episode[1]);
    if (value != null) {
      return { ...base, title: `第 ${value} 期`, sortKey: value, label: normalizeSuffix(text.slice(episode[0].length)) };
    }
  }

  return base;
}

/**
 * 把 segments 解析成「按期分组」的展示结构。
 * 分组按出现顺序输出，组内按上/中/下/加更排序（仅对「其他」组生效，
 * 因为其余组的 items 本就保持了用户录入顺序）。
 */
export function groupSegments(segments: string[], options: SegmentGroupOptions = {}): SegmentGroup[] {
  const { groupBySeason = true } = options;
  // 解析必须保持数组原序：空位的归属依赖"它前后最近的已看项"，一旦先排序就会错位。
  const parsed = segments.map((seg, index) => {
    const item = parseSegment(seg, index);
    return groupBySeason ? item : { ...item, title: '其他', sortKey: Number.MAX_SAFE_INTEGER, label: item.raw };
  });

  // 空格子的期数信息只存在于它的标签里，而空标签解析不出期数。若就地归入「其他」，
  // 取消勾选一项就会把它从所属期里拽出来。
  //
  // 归属规则：空位归给**索引距离最近**的已看项（距离相同取前一个）。
  // 不能简单"跟随前一个已看项"——那样清掉某一期开头的连续几项时，它们会被算进上一期。
  // 用就近规则，常见的"取消勾选某一期中间/末尾的条目"能准确留在原期。
  const resolvedTitle = new Map<number, string>();
  if (groupBySeason) {
    const watchedAt = parsed.map((item, i) => (item.watched ? i : -1)).filter((i) => i >= 0);
    for (const item of parsed) {
      if (item.watched) { resolvedTitle.set(item.index, item.title); continue; }
      if (watchedAt.length === 0) continue;
      let nearest = watchedAt[0];
      for (const i of watchedAt) {
        if (Math.abs(i - item.index) < Math.abs(nearest - item.index)) nearest = i;
      }
      resolvedTitle.set(item.index, parsed[nearest].title);
    }
  }

  // 每组的排序键取自该组内**非空项**的解析结果：空项本身解析不出期数，
  // 若拿组内首个元素兜底，会让「某期第一项被取消勾选」时整组顺序错乱。
  const sortKeyByTitle = new Map<string, number>();
  for (const item of parsed) {
    if (!item.watched) continue;
    const current = sortKeyByTitle.get(item.title);
    if (current == null || item.sortKey < current) sortKeyByTitle.set(item.title, item.sortKey);
  }

  // 归属确定后再建组；此时才允许排序。
  const groups: SegmentGroup[] = [];
  const byTitle = new Map<string, SegmentGroup>();
  for (const item of parsed) {
    const title = resolvedTitle.get(item.index) ?? item.title;
    let group = byTitle.get(title);
    if (!group) {
      group = {
        id: title,
        title,
        sortKey: sortKeyByTitle.get(title) ?? Number.MAX_SAFE_INTEGER,
        items: [],
      };
      byTitle.set(title, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  // 不出现「其他」分组：解析不出期号的行（用户自定义名称）并入索引距离最近的期组。
  // 「其他」是内部兜底概念，直接展示出来会让用户看到"没有归属"的一组；
  // 但若整份数据里根本没有期组（例如只有先导片），则保留原组，否则这些行会无处可去。
  const orphanIndex = groups.findIndex((group) => group.title === '其他');
  const periodGroups = groups.filter((group) => group.title !== '其他' && group.sortKey !== Number.MAX_SAFE_INTEGER);
  if (orphanIndex >= 0 && periodGroups.length > 0) {
    const orphans = groups[orphanIndex].items;
    for (const item of orphans) {
      let nearest = periodGroups[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const group of periodGroups) {
        for (const member of group.items) {
          const distance = Math.abs(member.index - item.index);
          if (distance < bestDistance) { bestDistance = distance; nearest = group; }
        }
      }
      nearest.items.push(item);
    }
    // 并入后重算排序键，避免该组仍带着「其他」的极大值。
    for (const group of periodGroups) {
      const keys = group.items.filter((i) => i.watched).map((i) => i.sortKey);
      if (keys.length > 0) group.sortKey = Math.min(...keys);
    }
    groups.splice(orphanIndex, 1);
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

/** 某分组的已看数（标签非空即有内容）。 */
export function countWatched(group: SegmentGroup): number {
  return group.items.filter((item) => item.watched).length;
}

/**
 * 生成“下一期”的默认名称：取现有标签里最大的期号 +1，没有任何期号时退回「新分段」。
 *
 * 结果带 `上` 后缀，是为了让它立刻能被 PERIOD_PATTERN 识别、独立成「第 N 期」组，
 * 而不是落进「其他」。
 *
 * 已知语义代价：在本模型里「已看」等价于「标签非空」，所以新添加的一期会先显示为
 * **已看**。要根治需要把 segments 改为 `{ label, watched }[]` 并做数据迁移。
 */
export function nextPeriodLabel(segments: string[]): string {
  let max = 0;
  for (const segment of segments) {
    const matched = segment.trim().match(PERIOD_PATTERN);
    if (!matched) continue;
    const value = cnNumberToInt(matched[1]);
    if (value != null && value > max) max = value;
  }
  return max > 0 ? `第 ${max + 1} 期上` : '新分段';
}
