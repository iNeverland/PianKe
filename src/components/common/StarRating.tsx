interface StarRatingProps {
  value: number; // 0 / 2 / 4 / 6 / 8 / 10，每颗星 2 分
  onChange?: (value: number) => void;
  size?: number;
  readOnly?: boolean;
}

// 点击评分时的弹跳动画 keyframes (injected via style tag once)
let styleInjected = false;
function injectBounceKeyframes() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes star-pop {
      0% { transform: scale(1); }
      40% { transform: scale(1.35); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

export default function StarRating({ value, onChange, size = 20, readOnly = false }: StarRatingProps) {
  // 5 颗星，分别对应 2/4/6/8/10 分
  const stars = [2, 4, 6, 8, 10];
  // 可交互时命中区扩到 ≥44×44（HIG 触控热区），图标本身仍是 size；只读展示保持紧凑
  const hit = readOnly ? size : Math.max(44, size);

  injectBounceKeyframes();

  return (
    <div
      className="flex items-center gap-1"
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={readOnly ? `评分 ${value ? value / 2 : 0} 星` : '选择评分'}
    >
      {stars.map((star) => {
        const filled = star <= value;

        return (
          <button
            key={star}
            type="button"
            role={readOnly ? undefined : 'radio'}
            aria-checked={readOnly ? undefined : value === star}
            aria-hidden={readOnly || undefined}
            disabled={readOnly}
            onClick={() => {
              if (onChange) {
                onChange(star);
                // Trigger pop animation on the clicked star via ref animation
                const btn = document.activeElement as HTMLElement;
                if (btn) {
                  btn.style.animation = 'none';
                  btn.offsetHeight; // force reflow
                  btn.style.animation = 'star-pop 0.35s ease';
                }
              }
            }}
            className={`${readOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110'} transition-transform bg-transparent border-none p-0 flex items-center justify-center`}
            style={{ width: hit, height: hit }}
            aria-label={readOnly ? undefined : `${star / 2} 星`}
          >
            <svg
              viewBox="0 0 24 24"
              width={size}
              height={size}
              className={filled ? 'text-star' : 'text-muted'}
              style={{ transition: 'color 0.2s ease' }}
            >
              <path
                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                fill={filled ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
