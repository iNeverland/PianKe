import { useState, useCallback } from 'react';
import api from '@/lib/api';
import type { MovieMetadata, MovieSummary } from '@shared/types/index';

export function useMovies() {
  const [movie, setMovie] = useState<MovieMetadata | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMovie = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await api.movie.getById(id);
      setMovie(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  const createMovie = useCallback(async (data: Record<string, unknown>, posterFilePath?: string) => {
    const result = await api.movie.create(data, posterFilePath);
    return result;
  }, []);

  const updateMovie = useCallback(async (id: string, data: Record<string, unknown>, posterFilePath?: string) => {
    const result = await api.movie.update(id, data, posterFilePath);
    setMovie(result);
    return result;
  }, []);

  const deleteMovie = useCallback(async (id: string) => {
    await api.movie.delete(id);
    setMovie(null);
  }, []);

  const searchMovies = useCallback(async (query: string) => {
    return api.movie.search(query);
  }, []);

  const updateProgress = useCallback(async (id: string, episode: number) => {
    const result = await api.movie.updateProgress(id, episode);
    setMovie(result);
    return result;
  }, []);

  const addTag = useCallback(async (id: string, tag: string) => {
    const result = await api.movie.addTag(id, tag);
    setMovie(result);
    return result;
  }, []);

  const removeTag = useCallback(async (id: string, tag: string) => {
    const result = await api.movie.removeTag(id, tag);
    setMovie(result);
    return result;
  }, []);

  return {
    movie,
    loading,
    fetchMovie,
    createMovie,
    updateMovie,
    deleteMovie,
    searchMovies,
    updateProgress,
    addTag,
    removeTag,
  };
}
