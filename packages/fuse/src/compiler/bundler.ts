import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export interface BundleResult {
  chunkFileName: string;
  chunkCode: string;
}

/**
 * Bundles a component's generated client entry code into a standalone ESM chunk.
 */
export async function bundleClientChunk(
  componentName: string,
  clientEntryCode: string,
  componentDir: string,
): Promise<BundleResult> {
  const hash = crypto.createHash('sha256').update(clientEntryCode).digest('hex').slice(0, 8);
  const chunkFileName = `${componentName}.${hash}.js`;

  const result = await esbuild.build({
    stdin: {
      contents: clientEntryCode,
      resolveDir: componentDir,
      loader: 'ts',
      sourcefile: `${componentName}.client.ts`,
    },
    bundle: true,
    format: 'esm',
    target: 'es2020',
    write: false,
    minify: false, // keep clean for debug/inspection
  });

  const chunkCode = result.outputFiles[0].text;
  return { chunkFileName, chunkCode };
}

/**
 * Bundles the client loader runtime into an IIFE / standalone script.
 */
export async function bundleLoader(loaderSourcePath: string): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [loaderSourcePath],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify: false,
  });

  return result.outputFiles[0].text;
}

/**
 * Concatenates and cleans component CSS styles.
 */
export function bundleStyles(styles: string[]): string {
  return styles
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n');
}
