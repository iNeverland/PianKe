import { z } from 'zod';

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year)
    && date.getMonth() === Number(month) - 1
    && date.getDate() === Number(day);
}

function isValidTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59 && (match[3] === undefined || Number(match[3]) <= 59));
}

const OptionalDateSchema = z.union([
  z.string().refine(isValidDate, '日期无效'),
  z.literal(''),
]);
const RequiredDateSchema = z.string().refine(isValidDate, '日期格式不正确');
const OptionalTimeSchema = z.string().refine(isValidTime, '时间格式不正确');

export const ProgressSchema = z.preprocess((val: any) => {
  // 迁移旧多季格式 {season, episode, seasonEpisodes} → 新单集格式 {episode, totalEpisodes}
  if (val && typeof val === 'object' && Array.isArray(val.seasonEpisodes)) {
    const totalEpisodes = (val.seasonEpisodes as number[]).reduce((a, b) => a + b, 0);
    // 已看集数 = 前几季的总集数 + 当前季已看集数
    let watched = (val.episode as number) || 0;
    for (let i = 0; i < ((val.season as number) || 1) - 1; i++) {
      watched += (val.seasonEpisodes[i] as number) || 0;
    }
    return { episode: watched, totalEpisodes };
  }
  // 迁移更旧的格式 {totalSeasons, totalEpisodes}（v1）
  if (val && typeof val === 'object' && 'totalSeasons' in val && !('seasonEpisodes' in val) && 'totalEpisodes' in val) {
    const totalEpisodes = (val.totalEpisodes as number) || 0;
    const seasonCount = (val.totalSeasons as number) || 1;
    const epsPerSeason = Math.ceil(totalEpisodes / seasonCount);
    let watched = 0;
    for (let i = 0; i < ((val.season as number) || 1) - 1; i++) {
      watched += epsPerSeason;
    }
    watched += (val.episode as number) || 0;
    return { episode: watched, totalEpisodes };
  }
  return val;
}, z.object({
  // 多集影视允许为 0，表示尚未开始观看或已重置进度。
  episode: z.number().int().nonnegative(),
  totalEpisodes: z.number().int().positive(),
  segments: z.array(z.string()).optional(),
}));

export const MovieMetadataSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  titleOriginal: z.string().optional(),
  mediaType: z.enum(['电影', '剧集', '综艺', '纪录片', '动画']),
  director: z.string(),
  cast: z.array(z.string()).default([]),
  // 上映日期允许未知；表单一直允许留空，加载校验也必须与之保持一致。
  releaseDate: OptionalDateSchema,
  country: z.string(),
  genre: z.array(z.string()),
  tags: z.array(z.string()).default([]),
  runtime: z.number().int().nonnegative(),
  synopsis: z.string().optional(),
  rating: z.number().min(0).max(10), // 公共评分 0-10
  posterPath: z.string().regex(/^[^/\\]+$/).optional(),
  posterThumbPath: z.string().regex(/^[^/\\]+$/).optional(),
  status: z.enum(['在看', '已看完', '想看']),
  progress: ProgressSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  rewatchCount: z.number().int().nonnegative().optional(),
});

export const DiaryEntrySchema = z.object({
  id: z.string().uuid(),
  watchDate: RequiredDateSchema,
  watchTime: OptionalTimeSchema.optional(),
  rating: z.literal(-1),
  review: z.string().optional(),
  images: z.array(z.string()).max(9).default([]),
  kind: z.enum(['progress', 'status']),
});

export const WatchRecordSchema = z.object({
  id: z.string().uuid(),
  watchDate: RequiredDateSchema,
  watchTime: OptionalTimeSchema.optional(),
  rating: z.number().min(0).max(10),
  review: z.string().optional(),
});

export const LibraryInfoSchema = z.object({
  name: z.string().min(1),
  version: z.number().int(),
  createdAt: z.string().datetime({ offset: true }),
  movieCount: z.number().int().nonnegative(),
});

// 用于创建影视的输入校验
export const CreateMovieInputSchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  titleOriginal: z.string().optional(),
  mediaType: z.enum(['电影', '剧集', '综艺', '纪录片', '动画']),
  director: z.string().optional().default(''),
  cast: z.array(z.string()).default([]),
  releaseDate: OptionalDateSchema.optional().default(''),
  country: z.string().optional().default(''),
  genre: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  runtime: z.number().int().nonnegative().default(0),
  synopsis: z.string().optional(),
  rating: z.number().min(0).max(10).default(0),
  status: z.enum(['在看', '已看完', '想看']).default('想看'),
  progress: ProgressSchema.nullable().default(null),
  rewatchCount: z.number().int().nonnegative().optional(),
  // 海报 base64 数据（data URL 格式）
  posterBase64: z.string().optional(),
  posterExt: z.string().optional(),
});

// 用于创建手动追剧记录的输入校验
export const CreateWatchRecordInputSchema = z.object({
  watchDate: RequiredDateSchema,
  watchTime: OptionalTimeSchema.optional(),
  rating: z.number().min(0).max(10), // 个人评分 0-10（5 星制，每星 2 分）
  review: z.string().optional(),
});

// 用于更新影视的输入校验（白名单，防止覆盖 id/createdAt 等字段）
export const UpdateMovieInputSchema = z.object({
  title: z.string().min(1).optional(),
  titleOriginal: z.string().optional(),
  mediaType: z.enum(['电影', '剧集', '综艺', '纪录片', '动画']).optional(),
  director: z.string().optional(),
  cast: z.array(z.string()).optional(),
  releaseDate: OptionalDateSchema.optional(),
  country: z.string().optional(),
  genre: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  runtime: z.number().int().nonnegative().optional(),
  synopsis: z.string().optional(),
  rating: z.number().min(0).max(10).optional(),
  status: z.enum(['在看', '已看完', '想看']).optional(),
  progress: ProgressSchema.nullable().optional(),
  rewatchCount: z.number().int().nonnegative().optional(),
  posterBase64: z.string().optional(),
  posterExt: z.string().optional(),
  removePoster: z.boolean().optional(),
});
