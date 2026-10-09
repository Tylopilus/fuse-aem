# Fuse runtime contract

This document is the single source of truth for how the three parts of Fuse talk to each other:

1. **Compiler** (`packages/fuse/src/compiler`) – turns `*.tsx` into HTL, dialog XML, Java, CSS and JS chunks.
2. **Java runtime** (`java/fuse-runtime`, OSGi bundle, package `dev.fuse.aem.runtime`) – runs inside AEM.
3. **Client loader** (`packages/fuse/src/client`, served as `fuse-loader.js`) – runs in the browser.

The dev preview (`packages/fuse/src/dev`) re-implements (2) in JavaScript for local development only.

---

## 1. HTML attribute contract (HTL output ⇄ client loader)

| Attribute | On | Meaning |
|---|---|---|
| `data-fuse-c="<chunkUrl>"` | component host (root element) | URL of the component's lazily imported ES module chunk. Marks the element as a *host*. |
| `data-fuse-s-<key>="<value>"` | host | Initial value of signal `<key>` (kebab-case of the signal name). Typed via `$meta` in the chunk. |
| `data-fuse-p-<key>="<value>"` | host | Value of a component prop that is captured by client code (kebab-case). Typed via `$meta`. |
| `data-fuse-on-<event>="<sym> [<sym>…]"` | any element | Run chunk export(s) `<sym>` when `<event>` bubbles through this element. |
| `data-fuse-pd-<event>` | any element | Call `preventDefault()` synchronously for `<event>` (handlers load async). |
| `data-fuse-visible="<sym>"` | any element | Run chunk export `<sym>` once when the element first becomes visible (`useVisibleTask$`). |
| `data-fuse-b="<target>=<sym> …"` | any element | Reactive bindings. `<target>` is `text` (sets `textContent`) or `attr:<name>` (sets attribute; `false`/`null`/`undefined` removes it, `true` sets it to `""`). |
| `<fuse-await id="<id>">fallback</fuse-await>` | anywhere | Placeholder for a streamed (out-of-order) block. Styled `display:contents`. |
| `<template data-fuse-r="<id>">html</template>` | end of `<body>` | Resolved content for placeholder `<id>`; the loader replaces the placeholder with the template content. `data-fuse-error` attribute marks a failed/timed-out block (fallback stays). |
| `<template data-fuse-ready="<id>"></template>` | immediately after the corresponding resolved/error template | Completion marker. It must be written after the resolved template's closing tag. The loader waits for this marker before swapping while the document is loading. |

Value encoding for `data-fuse-s-*` / `data-fuse-p-*` (`$meta[].type`):

* `string` – raw attribute value (missing attribute → `""`)
* `number` – `Number(value)` (missing → `0`)
* `boolean` – the compiler always renders the literal strings `true` / `false`
* `json` – `JSON.parse(value)` (only used for compile-time literals)

### Chunk module shape

```js
export const $meta = {
  signals: [{ name: 'open', key: 'open', type: 'boolean' }],
  props:   [{ name: 'heading', key: 'heading', type: 'string' }],
};
// handlers: (event, element, scope) => void | Promise<void>
export const s0 = (event, element, scope) => { … };
// bindings: (scope) => value
export const b0 = (scope) => …;
// visible tasks: (scope) => void | (() => void)
export const v0 = (scope) => { … };
```

`scope = { sig: { [name]: Signal }, props: { [name]: value }, host: Element }`, where a `Signal` has a `.value` getter/setter. Setting `.value` reevaluates all `data-fuse-b` bindings inside that host synchronously (excluding nested hosts). Events awaiting the same first module import share a single initialized scope.

Streaming HTML can be split at any byte boundary. The opening `<template>` element is not evidence that its content has arrived. The loader consumes completion markers and swaps complete templates whose placeholders exist; completed nested blocks remain pending until an outer swap inserts their placeholders. After `DOMContentLoaded`, it can also consume unmarked templates from older runtimes.

---

## 2. HTL contract (generated HTL ⇄ Java runtime)

### Models

* `dev.fuse.aem.runtime.FuseModel` – abstract base class of every generated `*Props` class.
  Request-adaptable Sling Model base. Provides:
  * `protected SlingHttpServletRequest request` (`@Self`), `protected Resource resource` (`@SlingObject`)
  * `protected <T> CompletableFuture<T> async(String key, Supplier<T> supplier)` – memoised per request + resource path + key, executed on the `FuseExecutor` pool. **The supplier must not use the request's ResourceResolver** (not thread-safe).
  * `protected String link(String path)` – `/content/...` without extension → `resolver.map(path) + ".html"`; anything else returned unchanged; `null` → `null`.
* Generated `<Name>Props extends FuseModel` (package `<basePackage>.components.<name>`) – typed getters for the dialog fields.
* Optional user `<Name>Model extends <Name>Props` – co-located business logic. If present, the HTL uses it instead of `<Name>Props`.

### Use-objects used by generated HTL

```html
<!-- every generated component script starts with -->
<sly data-sly-use.fz="dev.fuse.aem.runtime.FuseContext"
     data-sly-use.m="com.acme.components.teaser.TeaserModel"/>

<!-- normal render -->
<sly data-sly-test="${!fz.streamKey}"> … component markup … </sly>

<!-- an <Await> block inside the normal render -->
<sly data-sly-use.aw0="${'dev.fuse.aem.runtime.Await' @ key='aw0', value=m.quotes}">
  <fuse-await data-sly-test="${aw0.pending}" id="${aw0.id}"> fallback </fuse-await>
  <sly data-sly-test="${!aw0.pending}"><sly data-sly-set.quotes="${aw0.value}"> resolved </sly></sly>
</sly>

<!-- stream re-render of that block (only emitted when the component contains <Await>) -->
<sly data-sly-test="${fz.streamKey == 'aw0'}">
  <sly data-sly-use.aw0="${'dev.fuse.aem.runtime.Await' @ key='aw0'}"> resolved </sly>
</sly>
```

* `FuseContext` (request-adaptable Sling Model)
  * `getStreamKey()` – the Await key being stream-rendered for **this resource** in the current include, otherwise `null`.
  * `isEditMode()` – `WCMMode` is not `DISABLED`.
* `Await` (request-adaptable Sling Model, HTL use params arrive as request attributes `key` and `value`)
  * `isPending()`, `getValue()`, `getId()`
  * Algorithm (`@PostConstruct`):
    1. If `StreamContext` says we are stream-rendering this resource + key → `value` = the resolved value, `pending=false`.
    2. Else if `value` is not a `Future` → as-is, `pending=false`.
    3. Else if the future is already done → `value=join()`, `pending=false`.
    4. Else if streaming is not *armed* for this request (see below) or WCM mode is not `DISABLED` → block with timeout, `pending=false` (on timeout/failure `value=null`).
    5. Else register `{id, future, resourcePath, resourceType, key}` with `StreamContext`, `pending=true`. `id` is `fz-<n>` (per-request counter).
* `PageStream` (request-adaptable Sling Model) – used once in the page head (`customheaderlibs.html`): *arms* streaming for this request (`StreamContext.arm()`), unless WCM mode is not `DISABLED`, the request isn't a GET, or the query parameter `fuse-stream=off` is present.
* `StreamServlet` – Sling servlet for resource type `fuse/components/stream`, included in `customfooterlibs.html` via
  `<sly data-sly-resource="${'fuse-stream' @ resourceType='fuse/components/stream'}"/>`.
  Flushes the response, then repeatedly waits for the next completed future (`CompletableFuture.anyOf`, bounded by the global timeout) and for each:
  sets the stream target in `StreamContext`, buffers an include of the original resource (forced resource type, **no WCM decoration**), writes the resolved template followed by `<template data-fuse-ready="<id>"></template>`, and flushes.
  Failed / timed-out entries emit `<template data-fuse-r="<id>" data-fuse-error></template>` followed by the same completion marker.
* `StreamContext` – plain Java object stored as a request attribute `dev.fuse.aem.runtime.StreamContext`.
* `FuseExecutor` – OSGi service with a bounded thread pool. OSGi config `dev.fuse.aem.runtime.FuseExecutor`: `threads` (default 8), `timeoutMs` (default 5000), `queueSize` (default 1000). A saturated active pool returns an exceptionally completed future instead of running slow work on the request thread. Cancelling a future cancels its queued task or interrupts its worker. Suppliers must honor interruption and configure connection/read timeouts. Models used without an executor (for example, isolated tests) still have an inline fallback.
