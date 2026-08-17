import { useState } from 'react';
import AppIcon from '@/components/common/AppIcon';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  className?: string;
}

export default function PasswordInput({ value, onChange, placeholder, autoComplete, required, minLength, className }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input-wrap">
      <input
        className={`form-input password-input${className ? ` ${className}` : ''}`}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        title={visible ? '隐藏密码' : '显示密码'}
      >
        <AppIcon name={visible ? 'eyeOff' : 'eye'} className="icon-md" />
      </button>
    </div>
  );
}
