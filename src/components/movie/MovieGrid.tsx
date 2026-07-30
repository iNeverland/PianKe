import type { MovieSummary } from '@shared/types/index';
import MovieCard from './MovieCard';
import EmptyState from '../common/EmptyState';

interface MovieGridProps {
  movies: MovieSummary[];
  emptyTitle?: string;
  emptyDescription?: string;
  onStatusChange?: () => void;
  onDelete?: (id: string) => void;
}

export default function MovieGrid({ movies, emptyTitle = '暂无影视', emptyDescription, onStatusChange, onDelete }: MovieGridProps) {
  if (movies.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="movie-grid">
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} onStatusChange={onStatusChange} onDelete={onDelete} />
      ))}
    </div>
  );
}
