/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Apple systemBlue-derived accent ramp
        primary: {
          50: '#eef7ff',
          100: '#d9edff',
          200: '#b3d9ff',
          300: '#7cc0ff',
          400: '#4da3ff',
          500: '#0A84FF',
          600: '#007AFF',
          700: '#0062cc',
          800: '#004994',
          900: '#003166',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 24px -4px rgba(0, 0, 0, 0.12)',
        'soft-lg': '0 2px 8px rgba(0, 0, 0, 0.08), 0 16px 40px -8px rgba(0, 0, 0, 0.18)',
      },
      backdropBlur: {
        vibrancy: '20px',
      },
    },
  },
  plugins: [],
}

