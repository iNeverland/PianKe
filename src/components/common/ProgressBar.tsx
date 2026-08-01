interface ProgressBarProps {
  label: string;
  percent: number;
  showPercent?: boolean;
  className?: string;
}

export default function ProgressBar({ label, percent, showPercent = true, className = '' }: ProgressBarProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-[0.65rem] text-text-muted w-9 flex-shrink-0">{label}</span>
      <div className="stat-bar-bg rounded-full overflow-hidden flex-1" style={{ height: 3, maxWidth: 140 }}>
        <div className="stat-bar-fill rounded-full h-full" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      {showPercent && (
        <span className="text-[0.65rem] text-text-secondary font-semibold w-7 text-right flex-shrink-0">
          {Math.round(percent)}%
        </span>
      )}
    </div>
  );
}
