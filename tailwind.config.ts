import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { accent: 'rgb(var(--accent) / <alpha-value>)' },
    },
  },
  plugins: [],
} satisfies Config;
