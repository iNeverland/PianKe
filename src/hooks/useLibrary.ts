import { useState, useCallback } from 'react';
import api from '@/lib/api';
import type { LibraryInfo, MovieSummary } from '@shared/types/index';

export function useLibrary() {
  const [libraryInfo, setLibraryInfo] = useState<LibraryInfo | null>(null);
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const openLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const info = await api.library.open();
      if (info) {
        setLibraryInfo(info);
        const summary = await api.library.getSummary();
        setMovies(summary);
      }
      return info;
    } finally {
      setLoading(false);
    }
  }, []);

  const createLibrary = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const info = await api.library.create(name);
      setLibraryInfo(info);
      setMovies([]);
      return info;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshMovies = useCallback(async () => {
    const summary = await api.library.getSummary();
    setMovies(summary);
  }, []);

  const refreshInfo = useCallback(async () => {
    const info = await api.library.getInfo();
    setLibraryInfo(info);
  }, []);

  return {
    libraryInfo,
    movies,
    loading,
    openLibrary,
    createLibrary,
    refreshMovies,
    refreshInfo,
    setLibraryInfo,
  };
}
