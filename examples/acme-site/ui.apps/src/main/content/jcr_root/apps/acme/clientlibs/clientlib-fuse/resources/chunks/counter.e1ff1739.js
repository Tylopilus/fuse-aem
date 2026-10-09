// examples/acme-site/src/components/counter/counter.client.ts
var $meta = { "signals": [{ "name": "count", "key": "count", "type": "number" }], "props": [{ "name": "step", "key": "step", "type": "number" }, { "name": "initialCount", "key": "initial-count", "type": "number" }] };
var b0 = (__s, __el) => {
  const { count } = __s.sig;
  return count.value;
};
var s0 = (__e, __el, __s) => {
  const { count } = __s.sig;
  const props = { "step": __s.props["step"] };
  return (() => {
    count.value = count.value + props.step;
  })(__e, __el);
};
var s1 = (__e, __el, __s) => {
  const { count } = __s.sig;
  const props = { "step": __s.props["step"] };
  return (() => {
    count.value = count.value - props.step;
  })(__e, __el);
};
var s2 = (__e, __el, __s) => {
  const { count } = __s.sig;
  const props = { "initialCount": __s.props["initialCount"] };
  return (() => {
    count.value = props.initialCount;
  })(__e, __el);
};
export {
  $meta,
  b0,
  s0,
  s1,
  s2
};
