import { component$, dialog, field, useSignal, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'PromoBanner',
  group: 'Acme',
  fields: {
    heading: field.text({ label: 'Heading', required: true }),
    description: field.textarea({ label: 'Description' }),
  },
});

export default component$<typeof schema>(({ props }) => {
  const count = useSignal(0);

  useStyles$(`
    .cmp-promo-banner {
      padding: 1rem;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
    }
  `);

  return (
    <div class="cmp-promo-banner">
      <h2>{props.heading}</h2>
      <p>{props.description}</p>
      <button onClick$={() => count.value++}>
        Clicked {count.value} times
      </button>
    </div>
  );
});
