/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "#1A1A1A",
        sidebar: "#141414",
        card: "#202020",
        border: "#2E2E2E",
        hover: "#262626",
        selected: "#2A2A2A",
        ink: "#ECECEC",
        muted: "#8B8B8B",
        accent: "#3B82F6",
        success: "#22C55E",
        danger: "#EF4444",
        warning: "#F59E0B",
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        card: "10px",
        composer: "16px",
        sidebar: "8px",
      },
    },
  },
  plugins: [],
};
