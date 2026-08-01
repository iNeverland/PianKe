export default function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 mb-4">
          <div className="w-12 h-[72px] rounded-md bg-bg-elevated flex-shrink-0" />
          <div className="flex-1">
            <div className="h-4 rounded bg-bg-elevated w-2/3 mb-2" />
            <div className="h-3 rounded bg-bg-elevated w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="movie-grid animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-[var(--radius)] bg-bg-elevated" />
          <div className="mt-2.5 h-4 rounded bg-bg-elevated w-3/4" />
          <div className="mt-1.5 h-3 rounded bg-bg-elevated w-1/2" />
        </div>
      ))}
    </div>
  );
}
