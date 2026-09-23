/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Industrial cab palette: deep charcoal ground, CAT yellow for action.
        ink: { 900: '#0B0E13', 800: '#11151C', 700: '#171C25', 600: '#1F2630', 500: '#2A323E' },
        line: { DEFAULT: '#2C3542', soft: '#232B36' },
        cat: { DEFAULT: '#FFCD11', dark: '#E0B400', deep: '#8A6E00' },
        ok: '#3DD68C',
        warn: '#FFB020',
        crit: '#FF5A5F',
        mute: '#8A97A8',
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 32px -12px rgba(0,0,0,0.7)',
        glow: '0 0 0 1px rgba(255,205,17,0.35), 0 0 28px -6px rgba(255,205,17,0.45)',
      },
      keyframes: {
        pulsering: { '0%': { transform: 'scale(1)', opacity: '0.55' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        risein: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        pulsering: 'pulsering 1.6s ease-out infinite',
        risein: 'risein 0.28s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
}
