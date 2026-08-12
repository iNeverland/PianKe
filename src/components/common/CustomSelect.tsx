import { useState, useRef, useEffect } from 'react';
import AppIcon from './AppIcon';

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  className?: string;
}

export default function CustomSelect({ value, onChange, options, className = '' }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label || value;

  return (
    <div ref={ref} className={`custom-select ${className}`}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen(!open)}
      >
        <span className="custom-select-label">{selectedLabel}</span>
        <AppIcon name="chevronDown" className="custom-select-chevron" />
      </button>
      {open && (
        <div className="custom-select-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`custom-select-item ${opt.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
              {opt.value === value && (
                <AppIcon name="check" className="custom-select-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
