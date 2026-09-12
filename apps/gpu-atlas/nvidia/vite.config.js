import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({ base: './', plugins: [react(), viteSingleFile()], build: {target:'es2020', chunkSizeWarningLimit:2000}, server:{port:5173,strictPort:true} });
