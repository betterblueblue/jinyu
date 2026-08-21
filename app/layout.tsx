import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "瑾瑜",
  description: "瑾瑜 · 正式命名报告",
};

// 防闪烁：在 hydration 前根据 localStorage / 系统偏好设置 <html data-theme>
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("jinyu-theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600;700;900&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-serif antialiased text-on-surface">{children}</body>
    </html>
  );
}
