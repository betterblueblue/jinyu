import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', '"Songti SC"', "serif"],
      },
      colors: {
        // 语义色名保留，值映射到 CSS 变量（:root 浅色 / [data-theme=dark] 深色 双套）
        // gold = 青玉主强调；cinnabar = 朱砂次强调；paper = 墨青正文；bg = 页面底
        primary: "var(--fg)",
        secondary: "var(--accent)",
        tertiary: "var(--seal)",
        cinnabar: "var(--seal)",
        surface: "var(--surface)",
        "surface-low": "var(--surface-mid)",
        bg: "var(--bg)",
        outline: "var(--muted)",
        "outline-variant": "var(--border-strong)",
        "on-surface": "var(--fg)",
        "on-surface-variant": "var(--body)",
        ink: "var(--fg)",
        "ink-card": "var(--surface)",
        paper: "var(--fg)",
        "paper-dim": "var(--muted)",
        gold: "var(--accent)",
        "gold-strong": "var(--accent-strong)",
        "gold-soft": "var(--accent-soft)",
        "on-gold": "var(--on-accent)",
        "seal-strong": "var(--seal-strong)",
        "seal-soft": "var(--seal-soft)",
        "on-seal": "var(--on-seal)",
        "body-text": "var(--body)",
        faint: "var(--faint)",
      },
      boxShadow: {
        card: "var(--shadow)",
        glow: "var(--shadow-glow)",
      },
    },
  },
  plugins: [],
};

export default config;
