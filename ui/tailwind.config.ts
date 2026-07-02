import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm near-black surfaces, layered for depth.
        ink: { DEFAULT: '#0a0a0c', 900: '#0a0a0c', 800: '#101013', 700: '#17171b', 600: '#202026', 500: '#2b2b33' },
        line: 'rgba(255,255,255,0.08)',
        // Signature gold.
        gold: { DEFAULT: '#f5c518', hover: '#ffd94a', soft: 'rgba(245,197,24,0.12)' },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '0.85rem', '2xl': '1.15rem' },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 34px -18px rgba(0,0,0,0.7)',
        pop: '0 8px 26px -10px rgba(245,197,24,0.5)',
        ring: '0 0 0 1px rgba(245,197,24,0.45)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: { 'fade-up': 'fade-up .3s cubic-bezier(.2,.6,.2,1) both', shimmer: 'shimmer 1.8s linear infinite' },
    },
  },
  plugins: [],
};

export default config;
