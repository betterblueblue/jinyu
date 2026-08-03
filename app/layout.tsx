import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "瑾瑜",
  description: "瑾瑜 · 正式命名报告",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-serif antialiased text-on-surface">{children}</body>
    </html>
  );
}
