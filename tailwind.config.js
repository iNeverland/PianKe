/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'selector',
  theme: {
    extend: {
      colors: {
        'bg-deep': 'var(--bg-deep)',
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-card': 'var(--bg-card)',
        'bg-card-hover': 'var(--bg-card-hover)',
        'bg-elevated': 'var(--bg-elevated)',
        accent: 'var(--accent)',
        'accent-dim': 'var(--accent-dim)',
        'accent-glow': 'var(--accent-glow)',
        border: 'var(--border)',
        'border-light': 'var(--border-light)',
        'border-deep': 'var(--border)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        star: 'var(--star-color)',
        red: 'var(--red)',
        green: 'var(--green)',
        blue: 'var(--blue)',
      },
      fontFamily: {
        display: ['Playfair Display', 'Noto Serif SC', 'Microsoft YaHei', 'serif'],
        body: ['DM Sans', 'Microsoft YaHei', 'sans-serif'],
        ui: ['DM Sans', 'sans-serif'],
      },
      borderRadius: {
        card: 'var(--radius)',
        btn: 'var(--radius)',
      },
    },
  },
  plugins: [],
};
