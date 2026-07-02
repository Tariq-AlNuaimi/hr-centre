// PostCSS pipeline — Tailwind v4 compiles through this single plugin (ADR-029
// Workstream C1). Next.js loads this file automatically for every CSS import;
// defining it REPLACES Next's default PostCSS chain, so @tailwindcss/postcss
// (which bundles Lightning CSS for nesting/autoprefixing) must stay the one
// entry here — no separate autoprefixer needed.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
