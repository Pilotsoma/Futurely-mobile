/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.{js,jsx,ts,tsx}',
    './index.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#00C896',
        'primary-dark': '#00A87E',
        background: '#0D1117',
        surface: '#161B22',
        border: '#30363D',
        'text-primary': '#E6EDF3',
        'text-secondary': '#8B949E',
        'text-muted': '#484F58',
        success: '#3FB950',
        warning: '#D29922',
        error: '#F85149',
        info: '#58A6FF',
      },
    },
  },
  plugins: [],
}
