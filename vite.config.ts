import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built folder can be opened from any static host path.
export default defineConfig({
  base: './',
  plugins: [react()],
});
