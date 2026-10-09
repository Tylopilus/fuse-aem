import { component$, dialog, field, useSignal, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Accordion',
  group: 'Acme Content',
  description: 'Collapsible accordion with multifield items',
  fields: {
    heading: field.text({ label: 'Accordion Heading', required: true }),
    items: field.multifield({
      label: 'Accordion Items',
      fields: {
        title: field.text({ label: 'Item Title', required: true }),
        body: field.richtext({ label: 'Item Content' }),
      },
    }),
  },
});

export default component$<typeof schema>(({ props }) => {
  const isOpen = useSignal(true);

  useStyles$(`
    .cmp-accordion {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
    }
    .cmp-accordion__header {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      background: #f8fafc;
      border: none;
      border-bottom: 1px solid #e2e8f0;
      cursor: pointer;
      font-size: 1.15rem;
      font-weight: 600;
      color: #0f172a;
      text-align: left;
    }
    .cmp-accordion__items {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .cmp-accordion__item {
      border-bottom: 1px solid #f1f5f9;
      padding: 16px 20px;
    }
    .cmp-accordion__item:last-child {
      border-bottom: none;
    }
    .cmp-accordion__item-title {
      margin: 0 0 8px 0;
      font-size: 1rem;
      color: #1e293b;
    }
    .cmp-accordion__item-body {
      color: #475569;
      line-height: 1.5;
    }
  `);

  return (
    <div class="cmp-accordion">
      <button class="cmp-accordion__header" onClick$={() => { isOpen.value = !isOpen.value; }}>
        <span>{props.heading}</span>
        <span>{isOpen.value ? '▲' : '▼'}</span>
      </button>
      <ul class="cmp-accordion__items" hidden={!isOpen.value}>
        {props.items.map((item) => (
          <li class="cmp-accordion__item">
            <h4 class="cmp-accordion__item-title">{item.title}</h4>
            <div class="cmp-accordion__item-body" html={item.body} />
          </li>
        ))}
      </ul>
    </div>
  );
});
