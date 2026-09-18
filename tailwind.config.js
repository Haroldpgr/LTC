/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f7f3f4',
          100: '#efe9eb',
          200: '#ddd5d8',
          300: '#beb3b7',
          400: '#9a8c91',
          500: '#75676c',
          600: '#55484d',
          700: '#3c3236',
          800: '#241d20',
          900: '#140f11',
          950: '#070405',
        },
        primary: {
          50: '#fff1f2',
          100: '#ffe4e6',
          200: '#ffc9cd',
          300: '#ff9ea6',
          400: '#fa6b78',
          500: '#e63946',
          600: '#c1121f',
          700: '#9e101c',
          800: '#86121c',
          900: '#70131b',
        },
        accent: {
          50: '#fff2f3',
          100: '#ffe1e3',
          200: '#ffc4c8',
          300: '#f79ba1',
          400: '#e3636b',
          500: '#c2262f',
          600: '#9d171f',
          700: '#801318',
          800: '#671218',
          900: '#551318',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass': 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
