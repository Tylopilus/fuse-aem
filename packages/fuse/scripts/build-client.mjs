import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const src = path.join(pkgRoot, 'src/client/fuse-loader.ts');
const outDir = path.join(pkgRoot, 'dist/client');

fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [src],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: path.join(outDir, 'fuse-loader.js'),
});

console.log('⚡ Built fuse-loader.js');
