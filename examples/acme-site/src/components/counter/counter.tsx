import { component$, dialog, field, useSignal, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Counter',
  group: 'Acme Interactive',
  description: 'Interactive counter with resumable signal state',
  fields: {
    initialCount: field.number({ label: 'Initial count', defaultValue: 0 }),
    step: field.number({ label: 'Increment step', defaultValue: 1 }),
  },
});

export default component$<typeof schema>(({ props }) => {
  const count = useSignal(props.initialCount);

  useStyles$(`
    .cmp-counter {
      display: inline-flex;
      align-items: center;
      gap: 16px;
      padding: 16px 24px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .cmp-counter__display {
      font-size: 1.25rem;
      font-weight: 600;
      min-width: 120px;
      color: #1e293b;
    }
    .cmp-counter__btn {
      padding: 8px 16px;
      font-size: 1rem;
      font-weight: 500;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #f1f5f9;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .cmp-counter__btn:hover {
      background: #e2e8f0;
    }
  `);

  return (
    <div class="cmp-counter">
      <span class="cmp-counter__display">Count: {count.value}</span>
      <button class="cmp-counter__btn" onClick$={() => { count.value = count.value + props.step; }}>
        +{props.step}
      </button>
      <button class="cmp-counter__btn" onClick$={() => { count.value = count.value - props.step; }}>
        -{props.step}
      </button>
      <button class="cmp-counter__btn" onClick$={() => { count.value = props.initialCount; }}>
        Reset
      </button>
    </div>
  );
});
