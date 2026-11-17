import { defineConfig } from 'vite';

/**
 * Builds `index.html` and `src/` into `dist/`, which is committed: PotentialPaper serves a plugin's files as they are
 * in the repo at a commit and never runs a build. File names carry no hash (a commit already pins them), so a
 * rebuild of unchanged code leaves `dist/` unchanged and CI can check it is up to date.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
