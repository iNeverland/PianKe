import { dataStore } from '../../store/dataStore.js';
import type { StatsOverview, StatsDashboard, StatsByType, StatsByYear, StatsByGenre, StatsByRating, StatsMonthlyTrend, MonthSummary, MovieSummary, DiaryEntry } from '../../../shared/types/index.js';

function getAllMovies() {
  return dataStore.getAllMovies();
}

function getCompletedMovies() {
  return dataStore.getAllMovies().filter((m) => m.status === '已看完');
}

function getWatchingOrCompletedMovies() {
  return dataStore.getAllMovies().filter((m) => m.status === '已看完' || m.status === '在看');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 国家字段兼容中文顿号、逗号和斜杠等多种分隔方式；同一部影视中的重复国家只计一次。 */
function splitCountries(country: string): string[] {
  return [...new Set(country.split(/[、，,／/]/).map((item) => item.trim()).filter(Boolean))];
}

function getDiaryRatingBucket(rating: number): number | null {
  if (rating <= 0) return null;

  let star: number;
  if (rating <= 5) {
    star = Math.round(rating * 2);
  } else {
    star = Math.round(rating / 2) * 2;
  }

  star = Math.max(2, Math.min(10, star));
  return star % 2 === 0 ? star : Math.round(star / 2) * 2;
}

export function getDashboard(): StatsDashboard {
  const movies = getAllMovies();
  const allDiaries = dataStore.getAllDiaries();
  const allWatchRecords = dataStore.getAllWatchRecords();

  const byTypeCount: Record<string, number> = {};
  const genreCount: Record<string, number> = {};
  const countryCount: Record<string, number> = {};
  const ratingCount: Record<number, number> = { 2: 0, 4: 0, 6: 0, 8: 0, 10: 0 };
  const monthCount: Record<string, number> = {};

  let totalMinutes = 0;
  let totalRating = 0;
  let personalRatingCount = 0;

  for (const movie of movies) {
    byTypeCount[movie.mediaType] = (byTypeCount[movie.mediaType] || 0) + 1;

    for (const genre of movie.genre) {
      genreCount[genre] = (genreCount[genre] || 0) + 1;
    }

    for (const country of splitCountries(movie.country)) {
      countryCount[country] = (countryCount[country] || 0) + 1;
    }

    const entries = allDiaries.get(movie.id) || [];
    const records = allWatchRecords.get(movie.id) || [];
    for (const entry of records) {
      if (entry.rating > 0) {
        totalRating += entry.rating;
        personalRatingCount++;
      }

      const bucket = getDiaryRatingBucket(entry.rating);
      if (bucket) ratingCount[bucket] = (ratingCount[bucket] || 0) + 1;
    }

    if (movie.status === '已看完') {
      totalMinutes += movie.progress?.totalEpisodes
        ? movie.runtime * movie.progress.totalEpisodes
        : movie.runtime;
    }

    if (movie.status === '已看完' || movie.status === '在看') {
      const months = new Set<string>();
      for (const entry of entries) {
        months.add(entry.watchDate.substring(0, 7));
      }
      for (const month of months) {
        monthCount[month] = (monthCount[month] || 0) + 1;
      }
    }
  }

  const mostWatchedGenre = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g);
  const stars = [
    { stars: 2, label: '★ 2分' },
    { stars: 4, label: '★★ 4分' },
    { stars: 6, label: '★★★ 6分' },
    { stars: 8, label: '★★★★ 8分' },
    { stars: 10, label: '★★★★★ 10分' },
  ];

  return {
    overview: {
      totalMovies: movies.length,
      totalHours: round1(totalMinutes / 60),
      avgPersonalRating: personalRatingCount > 0 ? round1(totalRating / personalRatingCount) : 0,
      mostWatchedGenre,
    },
    byType: (['电影', '剧集', '综艺', '纪录片', '动画'] as const).map(type => ({ type, count: byTypeCount[type] || 0 })),
    byGenre: Object.entries(genreCount)
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count),
    byCountry: Object.entries(countryCount)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count),
    diaryRatingDist: stars.map((s) => ({ ...s, count: ratingCount[s.stars] })),
    monthlyTrend: Object.entries(monthCount)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export function getOverview(): StatsOverview {
  const allMovies = getAllMovies();
  const completed = getCompletedMovies();

  // 计算总观影时长（仅已看完的）
  let totalMinutes = 0;
  for (const movie of completed) {
    if (movie.progress?.totalEpisodes) {
      totalMinutes += movie.runtime * movie.progress.totalEpisodes;
    } else {
      // 电影 / 纪录片 / 综艺 / 动画：片长
      totalMinutes += movie.runtime;
    }
  }

  // 计算平均个人评分（排除未评分的日记条目）
  let totalRating = 0;
  let ratingCount = 0;
  const allWatchRecords = dataStore.getAllWatchRecords();
  for (const [, entries] of allWatchRecords) {
    for (const entry of entries) {
      if (entry.rating > 0) {
        totalRating += entry.rating;
        ratingCount++;
      }
    }
  }
  const avgRating = ratingCount > 0 ? Math.round((totalRating / ratingCount) * 10) / 10 : 0;

  // 最常看类型（全部影视）
  const genreCount: Record<string, number> = {};
  for (const movie of allMovies) {
    for (const g of movie.genre) {
      genreCount[g] = (genreCount[g] || 0) + 1;
    }
  }
  const mostWatchedGenre = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g);

  return {
    totalMovies: allMovies.length,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    avgPersonalRating: avgRating,
    mostWatchedGenre,
  };
}

export function getByMediaType(): StatsByType[] {
  const movies = getAllMovies();
  const count: Record<string, number> = {};
  for (const movie of movies) {
    count[movie.mediaType] = (count[movie.mediaType] || 0) + 1;
  }
  return (['电影', '剧集', '综艺', '纪录片', '动画'] as const).map(type => ({ type, count: count[type] || 0 }));
}

export function getByYear(): StatsByYear[] {
  const completed = getCompletedMovies();
  const yearMap: Record<string, { count: number; totalRating: number }> = {};
  for (const movie of completed) {
    const year = movie.releaseDate.substring(0, 4);
    if (!yearMap[year]) yearMap[year] = { count: 0, totalRating: 0 };
    yearMap[year].count++;
    yearMap[year].totalRating += movie.rating;
  }
  return Object.entries(yearMap)
    .map(([year, data]) => ({
      year,
      count: data.count,
      avgRating: Math.round((data.totalRating / data.count) * 10) / 10,
    }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

export function getByGenre(): StatsByGenre[] {
  const movies = getAllMovies();
  const count: Record<string, number> = {};
  for (const movie of movies) {
    for (const g of movie.genre) {
      count[g] = (count[g] || 0) + 1;
    }
  }
  return Object.entries(count)
    .map(([genre, c]) => ({ genre, count: c }))
    .sort((a, b) => b.count - a.count);
}

export function getByRating(): StatsByRating[] {
  const completed = getCompletedMovies();
  const count: Record<number, number> = {};
  for (const movie of completed) {
    const rounded = Math.round(movie.rating);
    count[rounded] = (count[rounded] || 0) + 1;
  }
  return Object.entries(count)
    .map(([rating, c]) => ({ rating: Number(rating), count: c }))
    .sort((a, b) => a.rating - b.rating);
}

export function getByCountry(): { country: string; count: number }[] {
  const movies = getAllMovies();
  const count: Record<string, number> = {};
  for (const movie of movies) {
    for (const country of splitCountries(movie.country)) {
      count[country] = (count[country] || 0) + 1;
    }
  }
  return Object.entries(count)
    .map(([country, c]) => ({ country, count: c }))
    .sort((a, b) => b.count - a.count);
}

export function getDiaryRatingDistribution(): { stars: number; label: string; count: number }[] {
  const stars = [
    { stars: 2, label: '★ 2分' },
    { stars: 4, label: '★★ 4分' },
    { stars: 6, label: '★★★ 6分' },
    { stars: 8, label: '★★★★ 8分' },
    { stars: 10, label: '★★★★★ 10分' },
  ];

  const count: Record<number, number> = { 2: 0, 4: 0, 6: 0, 8: 0, 10: 0 };
  const allWatchRecords = dataStore.getAllWatchRecords();
  for (const [, entries] of allWatchRecords) {
    for (const entry of entries) {
      // 排除未评分的条目
      if (entry.rating <= 0) continue;
      // 将评分归到最近的星级（兼容旧数据 0.5-5 和新数据 0-10）
      let star: number;
      if (entry.rating <= 5) {
        // 旧格式 0.5-5 → 映射到 2/4/6/8/10
        star = Math.round(entry.rating * 2);
      } else {
        // 新格式 0-10
        star = Math.round(entry.rating / 2) * 2;
      }
      // 限制在有效范围
      star = Math.max(2, Math.min(10, star));
      if (star % 2 !== 0) star = Math.round(star / 2) * 2;
      count[star] = (count[star] || 0) + 1;
    }
  }
  return stars.map((s) => ({ ...s, count: count[s.stars] }));
}

export function getMonthlyTrend(): StatsMonthlyTrend[] {
  const movies = getWatchingOrCompletedMovies();
  const monthCount: Record<string, number> = {};

  for (const movie of movies) {
    const entries = dataStore.getDiary(movie.id);
    // 同一影视在同一月份只计一次（用 Set 去重月份）
    const months = new Set<string>();
    for (const entry of entries) {
      months.add(entry.watchDate.substring(0, 7));
    }
    for (const month of months) {
      monthCount[month] = (monthCount[month] || 0) + 1;
    }
  }

  return Object.entries(monthCount)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function getDiaryCalendar(days: number): { date: string; count: number }[] {
  const dateCount: Record<string, number> = {};
  const allDiaries = dataStore.getAllDiaries();

  // 计算截止日期（今天）
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  // 起始日期
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);

  for (const [, entries] of allDiaries) {
    for (const entry of entries) {
      const d = entry.watchDate.substring(0, 10); // YYYY-MM-DD
      const entryDate = new Date(d);
      if (entryDate >= startDate && entryDate <= endDate) {
        dateCount[d] = (dateCount[d] || 0) + 1;
      }
    }
  }

  return Object.entries(dateCount)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getMonthSummary(year: number, month: number): MonthSummary {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const completed = getCompletedMovies();
  const movies: MovieSummary[] = [];
  const diaryEntries: DiaryEntry[] = [];
  const allWatchRecords = dataStore.getAllWatchRecords();
  let totalMinutes = 0;
  let totalRating = 0;
  let ratingCount = 0;
  const genreCount: Record<string, number> = {};

  for (const movie of completed) {
    const entries = dataStore.getDiary(movie.id);
    let hasEntryThisMonth = false;

    for (const entry of entries) {
      if (entry.watchDate.startsWith(monthStr)) {
        hasEntryThisMonth = true;
        diaryEntries.push(entry);
      }
    }

    if (hasEntryThisMonth) {
      // 计算该影视的个人评分（从手动追剧记录中取均值）
      const watchRatings = (allWatchRecords.get(movie.id) || []).filter((e) => e.rating > 0).map((e) => e.rating);
      const monthRatings = (allWatchRecords.get(movie.id) || [])
        .filter((e) => e.watchDate.startsWith(monthStr) && e.rating > 0)
        .map((e) => e.rating);
      totalRating += monthRatings.reduce((sum, rating) => sum + rating, 0);
      ratingCount += monthRatings.length;
      const personalRating = watchRatings.length > 0
        ? Math.round(watchRatings.reduce((a, b) => a + b, 0) / watchRatings.length * 10) / 10
        : null;

      movies.push({
        id: movie.id,
        title: movie.title,
        titleOriginal: movie.titleOriginal,
        mediaType: movie.mediaType,
        rating: movie.rating,
        personalRating,
        posterThumbPath: movie.posterThumbPath,
        releaseDate: movie.releaseDate,
        genre: movie.genre,
        tags: movie.tags,
        status: movie.status,
        progress: movie.progress,
      });
      const realWatchCount = entries.filter(e => e.watchDate.startsWith(monthStr)).length || 1;
      totalMinutes += movie.runtime * realWatchCount;

      for (const g of movie.genre) {
        genreCount[g] = (genreCount[g] || 0) + 1;
      }
    }
  }

  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  return {
    year,
    month,
    totalMovies: movies.length,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    avgRating: ratingCount > 0 ? Math.round((totalRating / ratingCount) * 10) / 10 : 0,
    topGenres,
    movies,
    diaryEntries,
  };
}
