import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileTemplate, ComponentEntry, CompileContext } from '../src/compiler/template.js';
import { bundleClientChunk } from '../src/compiler/bundler.js';

export const counterEntry: ComponentEntry = {
  name: 'counter', pascal: 'Counter', dir: '/test/counter', file: '/test/counter/counter.tsx',
  isPartial: false,
  schema: { title: 'Counter', fields: { initialCount: { kind: 'number' }, step: { kind: 'number' } } },
  resourceType: 'acme/components/counter', modelClass: 'com.acme.components.counter.CounterProps',
  propsClass: 'com.acme.components.counter.CounterProps', javaPackage: 'com.acme.components.counter',
  javaModelFile: null, modelTypes: {}, mockFile: null, partialPath: '',
};

export const compileContext: CompileContext = {
  registry: new Map(), containerResourceType: 'core/wcm/components/container/v1/container',
  awaitClass: 'dev.fuse.aem.runtime.Await', contextClass: 'dev.fuse.aem.runtime.FuseContext',
};

export const readmeCounter = `
import { component$, useSignal } from '@fuse-aem/fuse';
export default component$(({ props }) => {
  const count = useSignal(props.initialCount || 0);
  return <div><span id="count">{count.value}</span>
    <button id="plus" onClick$={() => { count.value += (props.step || 1); }}>Increment</button>
  </div>;
});
`;

test('numeric fallback and conditional signals retain their numeric type', async () => {
  for (const initial of ['props.initialCount || 0', '(props.initialCount || 0) as number', 'props.step > 0 ? props.initialCount : 0']) {
    const compiled = compileTemplate(counterEntry, compileContext, readmeCounter.replace('props.initialCount || 0', initial));
    const bundle = await bundleClientChunk('counter', compiled.clientEntry!, process.cwd());
    const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.chunkCode).toString('base64')}`);
    assert.equal(mod.$meta.signals[0].type, 'number', initial);
    const scope = { sig: { count: { value: 5 } }, props: { step: 2 } };
    mod.s0(null, null, scope);
    assert.equal(scope.sig.count.value, 7);
  }
});

test('mixed numeric and string signal branches fail instead of silently changing state type', () => {
  const source = readmeCounter.replace('props.initialCount || 0', "props.initialCount || 'zero'");
  assert.throws(() => compileTemplate(counterEntry, compileContext, source), /must have the same type/);
});

test('chunk filenames change when an imported dependency changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-chunk-'));
  try {
    const source = 'import { value } from "./value.ts"; export const s0 = () => value;';
    fs.writeFileSync(path.join(dir, 'value.ts'), 'export const value = 1;');
    const first = await bundleClientChunk('counter', source, dir);
    fs.writeFileSync(path.join(dir, 'value.ts'), 'export const value = 2;');
    const second = await bundleClientChunk('counter', source, dir);
    assert.notEqual(first.chunkCode, second.chunkCode);
    assert.notEqual(first.chunkFileName, second.chunkFileName);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
