/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#0a0a0a',
        ink: '#f5f5f5',
        'mute-1': '#1a1a1a',
        'mute-2': '#3a3a3a',
        'mute-3': '#888888',
        'mute-4': '#bbbbbb',
        accent: '#00B899',
        'accent-bright': '#00D4AA',
      },
      fontFamily: {
        sans: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
