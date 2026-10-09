import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileTemplate, ComponentEntry, CompileContext } from '../src/compiler/template.js';
import { generateDialogXml, generateComponentContentXml } from '../src/compiler/dialog.js';
import { generateJavaProps, parseJavaModel } from '../src/compiler/java.js';

describe('Fuse Compiler Tests', () => {
  const dummyCtx: CompileContext = {
    registry: new Map(),
    containerResourceType: 'core/wcm/components/container/v1/container',
    awaitClass: 'dev.fuse.aem.runtime.Await',
    contextClass: 'dev.fuse.aem.runtime.FuseContext',
  };

  test('compiles static JSX to HTL', () => {
    const entry: ComponentEntry = {
      name: 'teaser',
      pascal: 'Teaser',
      dir: '/test/teaser',
      file: '/test/teaser/teaser.tsx',
      isPartial: false,
      schema: {
        title: 'Teaser',
        fields: {
          title: { kind: 'text', label: 'Title', required: true },
          description: { kind: 'textarea', label: 'Description' },
        },
      },
      resourceType: 'acme/components/teaser',
      modelClass: 'com.acme.components.teaser.TeaserProps',
      propsClass: 'com.acme.components.teaser.TeaserProps',
      javaPackage: 'com.acme.components.teaser',
      javaModelFile: null,
      modelTypes: {},
      mockFile: null,
      partialPath: 'acme/components/teaser/teaser.html',
    };

    const source = `
import { component$, dialog, field } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Teaser',
  fields: {
    title: field.text({ label: 'Title', required: true }),
    description: field.textarea({ label: 'Description' }),
  },
});

export default component$<typeof schema>(({ props }) => {
  return (
    <div class="cmp-teaser">
      <h2>{props.title}</h2>
      <p>{props.description}</p>
    </div>
  );
});
`;

    const compiled = compileTemplate(entry, dummyCtx, source);
    assert.ok(compiled.htl.includes('data-sly-use.m="com.acme.components.teaser.TeaserProps"'));
    assert.ok(compiled.htl.includes('<h2>${m.title}</h2>'));
    assert.ok(compiled.htl.includes('<p>${m.description}</p>'));
    assert.equal(compiled.hasClient, false);
  });

  test('compiles reactive signals and event handlers to lazy client symbols', () => {
    const entry: ComponentEntry = {
      name: 'counter',
      pascal: 'Counter',
      dir: '/test/counter',
      file: '/test/counter/counter.tsx',
      isPartial: false,
      schema: {
        title: 'Counter',
        fields: {
          initialCount: { kind: 'number', label: 'Initial' },
        },
      },
      resourceType: 'acme/components/counter',
      modelClass: 'com.acme.components.counter.CounterProps',
      propsClass: 'com.acme.components.counter.CounterProps',
      javaPackage: 'com.acme.components.counter',
      javaModelFile: null,
      modelTypes: {},
      mockFile: null,
      partialPath: 'acme/components/counter/counter.html',
    };

    const source = `
import { component$, dialog, field, useSignal } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Counter',
  fields: {
    initialCount: field.number({ label: 'Initial' }),
  },
});

export default component$<typeof schema>(({ props }) => {
  const count = useSignal(props.initialCount);

  return (
    <div class="cmp-counter">
      <span class="value">{count.value}</span>
      <button onClick$={() => { count.value++; }}>+1</button>
    </div>
  );
});
`;

    const compiled = compileTemplate(entry, dummyCtx, source);
    assert.equal(compiled.hasClient, true);
    assert.ok(compiled.htl.includes('data-fuse-c="__FUSE_CHUNK_URL__"'));
    assert.ok(compiled.htl.includes('data-fuse-s-count='));
    assert.ok(compiled.htl.includes('data-fuse-on-click='));
    assert.ok(compiled.htl.includes('data-fuse-b='));
    assert.ok(compiled.clientEntry?.includes('export const $meta'));
    assert.ok(compiled.clientEntry?.includes('export const s0'));
    assert.ok(compiled.clientEntry?.includes('export const b0'));
  });

  test('compiles <Await> streaming block to HTL fz and await structures', () => {
    const entry: ComponentEntry = {
      name: 'stock',
      pascal: 'Stock',
      dir: '/test/stock',
      file: '/test/stock/stock.tsx',
      isPartial: false,
      schema: {
        title: 'Stock',
        fields: {
          symbol: { kind: 'text', label: 'Symbol' },
        },
      },
      resourceType: 'acme/components/stock',
      modelClass: 'com.acme.components.stock.StockModel',
      propsClass: 'com.acme.components.stock.StockProps',
      javaPackage: 'com.acme.components.stock',
      javaModelFile: null,
      modelTypes: {},
      mockFile: null,
      partialPath: 'acme/components/stock/stock.html',
    };

    const source = `
import { component$, dialog, field, Await } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Stock',
  fields: {
    symbol: field.text({ label: 'Symbol' }),
  },
});

export default component$<typeof schema, { quotes: Promise<{ price: number }> }>(({ props, model }) => {
  return (
    <div class="cmp-stock">
      <h3>{props.symbol}</h3>
      <Await value={model.quotes} fallback={<p>Loading quotes...</p>}>
        {(q) => <p>Price: {q.price}</p>}
      </Await>
    </div>
  );
});
`;

    const compiled = compileTemplate(entry, dummyCtx, source);
    assert.ok(compiled.htl.includes('data-sly-use.fz="dev.fuse.aem.runtime.FuseContext"'));
    assert.ok(compiled.htl.includes('data-sly-use.aw0='));
    assert.ok(compiled.htl.includes('<fuse-await data-sly-test="${aw0.pending}" id="${aw0.id}">'));
    assert.ok(compiled.htl.includes('data-sly-test="${fz.streamKey == \'aw0\'}"'));
    assert.equal(compiled.stats.awaits, 1);
  });

  test('generates Touch UI Granite Dialog XML', () => {
    const schema = {
      title: 'Accordion',
      fields: {
        heading: { kind: 'text', label: 'Heading', required: true },
        open: { kind: 'checkbox', label: 'Initially open' },
        items: {
          kind: 'multifield',
          label: 'Items',
          fields: {
            title: { kind: 'text', label: 'Title' },
            body: { kind: 'richtext', label: 'Body' },
          },
        },
      },
    };

    const xml = generateDialogXml(schema as any);
    assert.ok(xml.includes('jcr:title="Accordion"'));
    assert.ok(xml.includes('granite/ui/components/coral/foundation/form/textfield'));
    assert.ok(xml.includes('granite/ui/components/coral/foundation/form/checkbox'));
    assert.ok(xml.includes('granite/ui/components/coral/foundation/form/multifield'));
    assert.ok(xml.includes('composite="{Boolean}true"'));
  });

  test('generates Java Props Model with correct Sling annotations', () => {
    const schema = {
      title: 'Accordion',
      fields: {
        heading: { kind: 'text', label: 'Heading', required: true },
        open: { kind: 'checkbox', label: 'Initially open' },
        items: {
          kind: 'multifield',
          label: 'Items',
          fields: {
            title: { kind: 'text', label: 'Title' },
          },
        },
      },
    };

    const java = generateJavaProps('com.acme.components.accordion', 'accordion', schema as any);
    assert.ok(java.includes('public class AccordionProps extends FuseModel'));
    assert.ok(java.includes('@ValueMapValue\n    private String heading;'));
    assert.ok(java.includes('public String getHeading()'));
    assert.ok(java.includes('@ValueMapValue\n    private boolean open;'));
    assert.ok(java.includes('public boolean isOpen()'));
    assert.ok(java.includes('@ChildResource\n    private List<ItemsItem> items;'));
    assert.ok(java.includes('public static class ItemsItem'));
  });
});
