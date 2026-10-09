// src/components/accordion/accordion.client.ts
var $meta = { "signals": [{ "name": "isOpen", "key": "is-open", "type": "boolean" }], "props": [] };
var s0 = (__e, __el, __s) => {
  const { isOpen } = __s.sig;
  return (() => {
    isOpen.value = !isOpen.value;
  })(__e, __el);
};
var b0 = (__s, __el) => {
  const { isOpen } = __s.sig;
  return isOpen.value ? "\u25B2" : "\u25BC";
};
var b1 = (__s, __el) => {
  const { isOpen } = __s.sig;
  return !!!isOpen.value;
};
export {
  $meta,
  b0,
  b1,
  s0
};
