import { useState, useCallback } from 'react';
import api from '@/lib/api';
import type { DiaryEntry, DiaryTimelineMonth } from '@shared/types/index';

export function useDiary() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [timeline, setTimeline] = useState<DiaryTimelineMonth[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchByMovie = useCallback(async (movieId: string) => {
    setLoading(true);
    try {
      const data = await api.diary.getByMovie(movieId);
      setEntries(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTimeline = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.diary.getTimeline();
      setTimeline(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    entries,
    timeline,
    loading,
    fetchByMovie,
    fetchTimeline,
  };
}
