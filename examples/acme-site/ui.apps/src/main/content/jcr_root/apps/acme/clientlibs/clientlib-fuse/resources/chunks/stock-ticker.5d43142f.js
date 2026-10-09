// examples/acme-site/src/components/stock-ticker/stock-ticker.client.ts
var $meta = { "signals": [], "props": [{ "name": "symbol", "key": "symbol", "type": "string" }] };
var v0 = (__s, __el) => {
  const props = { "symbol": __s.props["symbol"] };
  return (() => {
    console.log(`[stock-ticker] Ticker for ${props.symbol} became visible in viewport!`);
  })();
};
export {
  $meta,
  v0
};
