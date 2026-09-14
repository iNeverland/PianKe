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
  /** 校验失败时置为 true（aria-invalid），便于读屏播报错误状态 */
  invalid?: boolean;
  /** 关联的错误提示元素 id（aria-describedby） */
  describedBy?: string;
}

export default function PasswordInput({ value, onChange, placeholder, autoComplete, required, minLength, className, invalid, describedBy }: PasswordInputProps) {
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
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
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
