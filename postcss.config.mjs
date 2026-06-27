// Tailwind v4 uses a dedicated PostCSS plugin (no tailwind.config.js — the theme
// is CSS-first in app/globals.css via @theme). See UI-SPEC Part A / F.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
