import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, Browser } from 'playwright';
import { compileTemplate } from '../../src/compiler/template.js';
import { bundleClientChunk, bundleLoader } from '../../src/compiler/bundler.js';
import { DevRenderer } from '../../src/dev/index.js';

let browser: Browser;
let server: http.Server;
let baseUrl: string;
let completeSplit: (() => void) | undefined;
let splitStarted: Promise<void>;
let markSplitStarted: () => void;
let finishImport: (() => void) | undefined;
let importStarted: Promise<void>;
let markImportStarted: () => void;

before(async () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const loader = await bundleLoader(path.resolve(dir, '../../src/client/fuse-loader.ts'));
  const entry = {
    name: 'counter', pascal: 'Counter', dir, file: path.join(dir, 'counter.tsx'), isPartial: false,
    schema: { title: 'Counter', fields: { initialCount: { kind: 'number' }, step: { kind: 'number' } } },
    resourceType: 'acme/components/counter', modelClass: 'com.acme.CounterProps', propsClass: 'com.acme.CounterProps',
    javaPackage: 'com.acme', javaModelFile: null, modelTypes: {}, mockFile: null, partialPath: '',
  };
  const ctx = { registry: new Map(), containerResourceType: '', awaitClass: 'dev.fuse.aem.runtime.Await', contextClass: 'dev.fuse.aem.runtime.FuseContext' };
  const source = `import { component$, useSignal } from '@fuse-aem/fuse';
    export default component$(({props}) => {const count = useSignal(props.initialCount || 0);
    return <div><span id="count">{count.value}</span><button id="plus" onClick$={() => {count.value += (props.step || 1);}}>Increment</button></div>});`;
  const compiled = compileTemplate(entry, ctx, source);
  const chunk = await bundleClientChunk('counter', compiled.clientEntry!, dir);
  const renderer = new DevRenderer({
    srcDir: dir, appsDir: dir, coreDir: dir, clientLibDir: dir, clientLibUrl: '/',
    javaPackage: 'com.acme', resourceTypePrefix: 'acme/components',
  }, new Map([['counter', entry]]));
  await renderer.getTemplateFn('counter', compiled.htl.replace('__FUSE_CHUNK_URL__', '/counter.js'));
  const counter = await renderer.renderComponent('counter', { initialCount: 5, step: 2 }, {});

  server = http.createServer(async (req, res) => {
    if (req.url === '/loader.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(loader);
      return;
    }
    if (req.url === '/counter.js') {
      if (finishImport) {
        markImportStarted();
        await new Promise<void>((resolve) => { finishImport = resolve; });
      }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(chunk.chunkCode);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.write('<!doctype html><html><body>');
    if (req.url === '/split') {
      res.write('<fuse-await id="fz-1">Loading</fuse-await><script src="/loader.js"></script>');
      await new Promise<void>((resolve) => { completeSplit = resolve; });
      res.write('<template data-fuse-r="fz-1"><p id="resolved">');
      markSplitStarted();
      await new Promise<void>((resolve) => { completeSplit = resolve; });
      res.write('Resolved content</p></template><template data-fuse-ready="fz-1"></template>');
      // Keep the document open: the marker must resolve content before DOMContentLoaded.
      await new Promise<void>((resolve) => { completeSplit = resolve; });
    } else if (req.url === '/nested') {
      res.write('<fuse-await id="outer">Loading outer</fuse-await><script src="/loader.js"></script>');
      res.write('<template data-fuse-r="inner"><p id="resolved">Inner content</p></template><template data-fuse-ready="inner"></template>');
      res.write('<template data-fuse-r="outer"><fuse-await id="inner">Loading inner</fuse-await></template><template data-fuse-ready="outer"></template>');
    } else if (req.url === '/error') {
      res.write('<fuse-await id="fz-1">Keep fallback</fuse-await><script src="/loader.js"></script>');
      res.write('<template data-fuse-r="fz-1" data-fuse-error></template><template data-fuse-ready="fz-1"></template>');
    } else {
      res.write(counter + '<script src="/loader.js"></script>');
    }
    res.end('</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  browser = await chromium.launch();
});

after(async () => {
  completeSplit?.();
  finishImport?.();
  await browser?.close();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
});

test('split streamed HTML keeps its fallback until the complete block arrives', async () => {
  splitStarted = new Promise((resolve) => { markSplitStarted = resolve; });
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl + '/split', { waitUntil: 'commit' });
    await page.waitForFunction(() => (window as any).__FUSE_LOADED__);
    completeSplit!();
    await splitStarted;
    await page.waitForFunction(() => !!document.querySelector('template[data-fuse-r]'));
    assert.equal(await page.locator('fuse-await').textContent(), 'Loading');
    completeSplit!();
    await page.waitForFunction(() => document.querySelector('#resolved')?.textContent === 'Resolved content');
    assert.equal(await page.evaluate(() => document.readyState), 'loading');
    assert.equal(await page.locator('fuse-await').count(), 0);
    completeSplit!();
  } finally {
    completeSplit?.();
    await page.close();
  }
});

test('two first clicks share state while the chunk is loading', async () => {
  importStarted = new Promise((resolve) => { markImportStarted = resolve; });
  finishImport = () => {};
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl);
    await page.evaluate(() => { document.querySelector<HTMLButtonElement>('#plus')!.click(); document.querySelector<HTMLButtonElement>('#plus')!.click(); });
    await importStarted;
    finishImport!();
    await page.waitForFunction(() => document.querySelector('#count')?.textContent === '9');
    assert.equal(await page.locator('#count').textContent(), '9');
  } finally {
    finishImport?.();
    finishImport = undefined;
    await page.close();
  }
});

test('the README counter adds numbers after resuming from HTML', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl);
    await page.locator('#plus').click();
    await page.waitForFunction(() => document.querySelector('#count')?.textContent === '7');
    assert.equal(await page.locator('#count').textContent(), '7');
  } finally { await page.close(); }
});

test('a completed inner block waits until its outer placeholder exists', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl + '/nested');
    assert.equal(await page.locator('#resolved').textContent(), 'Inner content');
    assert.equal(await page.locator('fuse-await').count(), 0);
  } finally { await page.close(); }
});

test('a failed stream block preserves its fallback', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl + '/error');
    assert.equal(await page.locator('fuse-await[data-fuse-failed]').textContent(), 'Keep fallback');
  } finally { await page.close(); }
});
