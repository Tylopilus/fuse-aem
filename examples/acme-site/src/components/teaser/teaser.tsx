import { component$, dialog, field, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Teaser',
  group: 'Acme Content',
  description: 'Promotional teaser with title, description, link and image',
  fields: {
    title: field.text({ label: 'Title', required: true }),
    description: field.textarea({ label: 'Description' }),
    image: field.image({ label: 'Image asset' }),
    link: field.link({ label: 'CTA Link' }),
    showAction: field.checkbox({ label: 'Show CTA button', defaultValue: true }),
  },
});

export default component$<typeof schema>(({ props }) => {
  useStyles$(`
    .cmp-teaser {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 24px;
      border-radius: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .cmp-teaser__title {
      margin: 0;
      font-size: 1.5rem;
      color: #0f172a;
    }
    .cmp-teaser__description {
      margin: 0;
      color: #475569;
      line-height: 1.5;
    }
    .cmp-teaser__action {
      display: inline-block;
      align-self: flex-start;
      margin-top: 8px;
      padding: 8px 16px;
      background: #0284c7;
      color: #ffffff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
    }
    .cmp-teaser__action:hover {
      background: #0369a1;
    }
  `);

  return (
    <div class="cmp-teaser">
      <h2 class="cmp-teaser__title">{props.title}</h2>
      <p class="cmp-teaser__description">{props.description}</p>
      {props.showAction && (
        <a class="cmp-teaser__action" href={props.link}>
          Explore more &rarr;
        </a>
      )}
    </div>
  );
});
