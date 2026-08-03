import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', '"Songti SC"', "serif"],
      },
      colors: {
        primary: "#00362a",
        secondary: "#775a19",
        tertiary: "#65000a",
        cinnabar: "#c84646",
        surface: "#fbf9f5",
        "surface-low": "#f0ede6",
        bg: "#f7f5f0",
        outline: "#5c6561",
        "outline-variant": "#c0c8c4",
        "on-surface": "#1b1c1a",
        "on-surface-variant": "#404945",
      },
    },
  },
  plugins: [],
};

export default config;
