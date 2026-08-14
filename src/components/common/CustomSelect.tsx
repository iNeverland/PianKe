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
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label || value;

  function selectAt(index: number): void {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen((value) => !value);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) {
        setOpen(true);
      } else {
        selectAt((selectedIndex + direction + options.length) % options.length);
      }
    }
  }

  return (
    <div ref={ref} className={`custom-select ${className}`}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="custom-select-label">{selectedLabel}</span>
        <AppIcon name="chevronDown" className="custom-select-chevron" />
      </button>
      {open && (
        <div className="custom-select-menu" role="listbox" aria-label="选项">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`custom-select-item ${opt.value === value ? 'active' : ''}`}
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                selectAt(options.indexOf(opt));
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
