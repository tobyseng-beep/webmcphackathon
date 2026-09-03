import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        graph: 'graph.html',
        circuit: 'circuit.html',
        chemistry: 'chemistry.html',
        physics: 'physics.html',
        probe: 'probe.html',
      },
    },
  },
});
