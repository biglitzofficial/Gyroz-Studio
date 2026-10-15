/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#171717",
        graphite: "#303030",
        muted: "#666666",
        line: "#E6E3DC",
        paper: "#F7F6F2",
        surface: "#FFFFFF",
        accent: "#FFD500",
        "accent-hover": "#E6C000",
        success: "#237A57",
        warning: "#B7791F",
        danger: "#C53B32",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "sans-serif"],
        display: ["Instrument Serif", "Georgia", "serif"],
      },
      boxShadow: {
        lift: "0 12px 40px rgba(23, 23, 23, 0.06)",
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "6px",
      },
    },
  },
  plugins: [],
};
