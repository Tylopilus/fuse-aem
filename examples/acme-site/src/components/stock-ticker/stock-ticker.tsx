import { component$, dialog, field, Await, useVisibleTask$, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Stock Ticker',
  group: 'Acme Financial',
  description: 'Live streaming stock ticker with out-of-order resolution and intersection observer',
  fields: {
    symbol: field.text({ label: 'Stock Symbol', defaultValue: 'ADBE' }),
  },
});

export default component$<typeof schema, { quotes: Promise<{ symbol: string; price: number; change: string; positive: boolean }> }>(
  ({ props, model }) => {
    useStyles$(`
      .cmp-stock-ticker {
        padding: 20px;
        border-radius: 8px;
        background: #0f172a;
        color: #f8fafc;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .cmp-stock-ticker__header {
        font-size: 0.85rem;
        color: #94a3b8;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .cmp-stock-ticker__loading {
        color: #38bdf8;
        font-style: italic;
        padding: 12px 0;
        animation: pulse 1.5s infinite ease-in-out;
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
      }
      .cmp-stock-ticker__quote {
        display: flex;
        align-items: baseline;
        gap: 16px;
      }
      .cmp-stock-ticker__price {
        font-size: 2rem;
        font-weight: 700;
        color: #ffffff;
      }
      .cmp-stock-ticker__change {
        font-size: 1.15rem;
        font-weight: 600;
        color: #4ade80;
      }
    `);

    useVisibleTask$(() => {
      console.log(`[stock-ticker] Ticker for ${props.symbol} became visible in viewport!`);
    });

    return (
      <div class="cmp-stock-ticker">
        <div class="cmp-stock-ticker__header">Live Market &bull; {props.symbol}</div>
        <Await
          value={model.quotes}
          fallback={<div class="cmp-stock-ticker__loading">Connecting to market feed for {props.symbol}...</div>}
        >
          {(quotes) => (
            <div class="cmp-stock-ticker__quote">
              <span class="cmp-stock-ticker__price">{quotes.price} USD</span>
              <span class="cmp-stock-ticker__change">+{quotes.change}</span>
            </div>
          )}
        </Await>
      </div>
    );
  },
);
