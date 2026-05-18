/** @type {import('tailwindcss').Config} */
const preset = require('../design-system/build/outputs/tailwind/preset.cjs');

module.exports = {
  presets: [preset],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
};
