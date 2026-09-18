/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#d9edff",
          200: "#bcdfff",
          300: "#8ecbff",
          400: "#59adff",
          500: "#338cff",
          600: "#1b6df5",
          700: "#1457e1",
          800: "#1747b6",
          900: "#19408f",
        },
      },
    },
  },
  plugins: [],
};
