import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevServer } from '../src/dev/index.js';
import { resolveConfig } from '../src/cli/index.js';

describe('Fuse Dev Preview & Streaming Test', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const exampleDir = path.resolve(currentDir, '../../../examples/acme-site');

  test('dev server renders HTL and streams out-of-order chunks', async () => {
    const config = resolveConfig(exampleDir);
    const port = 3456;
    const server = await startDevServer({ config, port });

    try {
      const responseData = await new Promise<{ status: number; chunks: string[]; fullText: string }>((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/`, (res) => {
          const chunks: string[] = [];
          let fullText = '';

          res.on('data', (chunk) => {
            const str = chunk.toString();
            chunks.push(str);
            fullText += str;
          });

          res.on('end', () => {
            resolve({ status: res.statusCode || 0, chunks, fullText });
          });
        });

        req.on('error', reject);
      });

      assert.equal(responseData.status, 200);

      // Verify server-side HTL rendered parts
      assert.ok(responseData.fullText.includes('Experience Qwik-style AEM components'));
      assert.ok(responseData.fullText.includes('Count:'));
      assert.ok(responseData.fullText.includes('Frequently Asked Questions'));

      // Verify out-of-order streaming placeholder and template chunk
      assert.ok(responseData.fullText.includes('<fuse-await data-sly-test="${aw0.pending}"') || responseData.fullText.includes('data-fuse-r='));
      assert.ok(responseData.fullText.includes('<template data-fuse-r='));
      assert.ok(responseData.fullText.includes('520.45 USD'));

      // Verify clientlib references
      assert.ok(responseData.fullText.includes('fuse-loader.js'));
      assert.ok(responseData.fullText.includes('components.css'));
      assert.ok(responseData.fullText.includes('data-fuse-c='));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
