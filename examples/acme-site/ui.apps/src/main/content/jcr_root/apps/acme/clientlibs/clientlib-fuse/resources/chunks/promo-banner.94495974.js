// examples/acme-site/src/components/promo-banner/promo-banner.client.ts
var $meta = { "signals": [{ "name": "count", "key": "count", "type": "number" }], "props": [] };
var s0 = (__e, __el, __s) => {
  const { count } = __s.sig;
  return (() => count.value++)(__e, __el);
};
var b0 = (__s, __el) => {
  const { count } = __s.sig;
  return count.value;
};
export {
  $meta,
  b0,
  s0
};
