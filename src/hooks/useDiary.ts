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

  const addEntry = useCallback(async (movieId: string, data: Record<string, unknown>) => {
    const entry = await api.diary.add(movieId, data);
    setEntries((prev) => [...prev, entry]);
    return entry;
  }, []);

  const deleteEntry = useCallback(async (movieId: string, entryId: string) => {
    await api.diary.delete(movieId, entryId);
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  }, []);

  return {
    entries,
    timeline,
    loading,
    fetchByMovie,
    fetchTimeline,
    addEntry,
    deleteEntry,
  };
}
