import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', '"Songti SC"', "serif"],
      },
      colors: {
        primary: "#F2EDE3", // 米白：标题/正文/首推名/导航字
        secondary: "#C9A227", // 金：下划线/描边/小标记/hover
        tertiary: "#E0483E", // 朱砂红：强调
        cinnabar: "#E0483E", // 朱砂红：错误/CTA/主按钮
        surface: "#16211D", // 卡片/表单分组底
        "surface-low": "#1B2722", // hover/浅区
        bg: "#0E1714", // 页面底
        outline: "#A8A29A", // 次要文字
        "outline-variant": "#3A4540", // 边框
        "on-surface": "#F2EDE3", // 正文主字
        "on-surface-variant": "#C6BFB2", // 次要正文
        ink: "#0E1714", // 深墨底（别名）
        "ink-card": "#16211D", // 卡片底（别名）
        paper: "#F2EDE3", // 米白（别名）
        "paper-dim": "#A8A29A", // 暖灰（别名）
        gold: "#C9A227", // 金（别名）
      },
    },
  },
  plugins: [],
};

export default config;
