# Fuse: TSX components for AEM

**Fuse** is an experimental compiler for Adobe Experience Manager. It generates native HTL, Touch UI dialogs, Java Sling Models, CSS, and lazy client modules from restricted TSX component definitions.

TSX co-locates markup, dialog fields, styles, and browser handlers. Business logic still lives in co-located Java files. The browser resumes primitive signal state from HTML attributes without rerunning the component function. This is inspired by Qwik; it implements a smaller authoring model.

The local compiler, browser behavior, Java runtime, HTL syntax, and Maven packages have automated checks. A deployed AEM SDK and AEM Cloud delivery stack still need integration testing. Cloud streaming is experimental: servlet flushes do not guarantee progressive delivery through Dispatcher and the CDN.

## Quick start

Use Node.js 20 or later (22 recommended), JDK 21, and Maven 3.9 or later.

```bash
npm ci
npm run build
npm run dev -w @acme/acme-site
```

The preview is available at `http://localhost:3000`. Restart it after source changes; automatic rebuild and reload are not implemented.

---

## Capabilities and limits

1. **Zero Node.js in Production:**
   - Production AEM instances run **100% native AEM artifacts**: HTL templates, Granite/Coral Touch UI dialogs, Sling Models, and standard ClientLibraries.
   - No Node.js SSR sidecar or reverse proxy required.
2. **Lazy client modules:**
   - Handlers, bindings, and visible tasks are bundled into one hash-named ES module per component. It loads on the first handled event or visible task.
   - Signal changes update text and attribute bindings within that component. All its bindings are reevaluated on each change.
3. **Experimental out-of-order streaming:**
   - Long-running async data fetches (e.g. external APIs, stock tickers, commerce catalogs) wrap in `<Await value={model.promise} fallback={...}>`.
   - The page head must arm streaming with `PageStream`, and its footer must include `StreamServlet`. The example page component supplies both hooks.
   - Background tasks resolve concurrently. The request thread flushes resolved templates and completion markers; the browser swaps only fully received blocks.
   - Edit mode and `?fuse-stream=off` use blocking rendering. The executor fails new work when its queue is full; cancelled worker tasks are interrupted. External clients must configure their own timeouts.
4. **Co-located Java Models & Touch UI Dialogs:**
   - Dialog schemas (`dialog({ fields: ... })`) generate standard Granite UI Coral XML dialogs.
   - Generated typed Java `*Props.java` classes adapt from `SlingHttpServletRequest` and `Resource`.
   - Co-located Java business models (e.g. `StockTickerModel.java`) extend `*Props` and compile into the OSGi bundle.
5. **Local dev preview:**
   - `fuse dev` renders generated HTL using `@adobe/htlengine` and JavaScript mocks. It does not run Java, OSGi services, the authoring editor, or Dispatcher.

Component bodies support hook declarations and one JSX return. Server expressions must fit HTL: arithmetic and arbitrary function calls belong in Java getters. Lists are server rendered; changing a signal cannot add or remove list items. Signal conditionals toggle `hidden` on pre-rendered elements. Partials are server only, `<Await>` cannot appear in a loop, and client code cannot capture an awaited value or an entire multifield. Fallback and conditional signal expressions must have a consistent primitive type.

---

## 📁 Repository Structure

```
.
├── packages/
│   └── fuse/                  # Core compiler, CLI, JSX runtime & client loader
│       ├── src/
│       │   ├── compiler/      # Ahead-of-time compiler (HTL, XML, Java, Bundler)
│       │   ├── client/        # Resumable client loader (fuse-loader.ts)
│       │   ├── core/          # Authoring APIs (component$, dialog, field, Await, useSignal)
│       │   ├── dev/           # Local dev preview server with @adobe/htlengine
│       │   └── cli/           # CLI commands (`fuse build`, `fuse dev`, `fuse new`)
│       └── test/              # Unit & integration tests
├── java/
│   └── fuse-runtime/          # Native OSGi Java bundle (dev.fuse.aem:fuse-runtime)
│       ├── FuseModel.java     # Base Sling Model with async() and link() helpers
│       ├── FuseContext.java   # HTL context helper for streaming mode detection
│       ├── Await.java         # Sling Model coordinating streaming placeholders
│       ├── StreamServlet.java # Chunked HTTP streaming servlet (fuse/components/stream)
│       └── FuseExecutor.java  # Configurable OSGi thread pool service
└── examples/
    └── acme-site/             # Sample multi-module AEM project
        ├── src/components/    # Single-file component source directory
        │   ├── teaser/        # Static / server-only component
        │   ├── counter/       # Client-reactive component (useSignal, onClick$)
        │   ├── accordion/     # Composite component with Coral multifield
        │   ├── stock-ticker/  # Async streaming component (<Await> + Java Model)
        │   └── promo-banner/  # Scaffolded component
        ├── ui.apps/           # Compiled HTL templates, dialogs, clientlibs
        └── core/              # Compiled Java Sling Models
```

---

## 🛠️ Component Authoring Guide

### 1. Static / Server-Only Component (`teaser.tsx`)
```tsx
import { component$, dialog, field, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Teaser',
  group: 'Acme Content',
  fields: {
    title: field.text({ label: 'Title', required: true }),
    description: field.textarea({ label: 'Description' }),
    link: field.link({ label: 'CTA Link' }),
    showAction: field.checkbox({ label: 'Show CTA button', defaultValue: true }),
  },
});

export default component$<typeof schema>(({ props }) => {
  useStyles$(`
    .cmp-teaser { padding: 24px; border-radius: 8px; background: #f8fafc; }
    .cmp-teaser__title { margin: 0; font-size: 1.5rem; color: #0f172a; }
  `);

  return (
    <div class="cmp-teaser">
      <h2 class="cmp-teaser__title">{props.title}</h2>
      <p>{props.description}</p>
      {props.showAction && (
        <a href={props.link} class="cmp-teaser__action">Explore more &rarr;</a>
      )}
    </div>
  );
});
```

### 2. Client-Reactive Component with Signals (`counter.tsx`)
```tsx
import { component$, dialog, field, useSignal, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Counter',
  fields: {
    initialCount: field.number({ label: 'Initial Count', defaultValue: 0 }),
    step: field.number({ label: 'Step increment', defaultValue: 1 }),
  },
});

export default component$<typeof schema>(({ props }) => {
  const count = useSignal(props.initialCount || 0);

  return (
    <div class="cmp-counter">
      <span class="cmp-counter__value">Count: {count.value}</span>
      <button onClick$={() => { count.value += (props.step || 1); }}>
        Increment (+{props.step || 1})
      </button>
    </div>
  );
});
```
*Handlers share a hash-named module for this component. Its initial count is rendered into HTML on the server.*

### 3. Out-of-Order Streaming with Co-located Java Model (`stock-ticker.tsx`)
```tsx
import { component$, dialog, field, Await, useVisibleTask$, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: 'Stock Ticker',
  fields: {
    symbol: field.text({ label: 'Stock Symbol', defaultValue: 'ADBE' }),
  },
});

export default component$<typeof schema, { quotes: Promise<{ price: number; change: string }> }>(
  ({ props, model }) => {
    useVisibleTask$(() => {
      console.log(`Ticker for ${props.symbol} visible in viewport`);
    });

    return (
      <div class="cmp-stock-ticker">
        <div class="cmp-stock-ticker__header">Live Market &bull; {props.symbol}</div>
        <Await
          value={model.quotes}
          fallback={<div class="loading">Fetching live quote for {props.symbol}...</div>}
        >
          {(quotes) => (
            <div class="cmp-stock-ticker__quote">
              <span class="price">{quotes.price} USD</span>
              <span class="change">+{quotes.change}</span>
            </div>
          )}
        </Await>
      </div>
    );
  }
);
```

Co-located Java Model (`StockTickerModel.java`):
```java
package com.acme.components.stockticker;

import dev.fuse.aem.runtime.FuseModel;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Model;
import java.util.concurrent.CompletableFuture;

@Model(adaptables = {SlingHttpServletRequest.class, Resource.class})
public class StockTickerModel extends StockTickerProps {

    public CompletableFuture<StockQuote> getQuotes() {
        String symbol = getSymbol(); // Read model properties on the request thread.
        return async("quotes", () -> fetchLiveQuote(symbol));
    }
}
```

`StockQuote` and `fetchLiveQuote` above represent your API client. The runnable example in `examples/acme-site` uses a simulated quote and reads its symbol before starting the worker task. Worker tasks must not use the request's ResourceResolver.

---

## ⚡ CLI Workflow

### Scaffold a New Component
```bash
fuse new promo-banner
```
Creates:
- `src/components/promo-banner/promo-banner.tsx`
- `src/components/promo-banner/PromoBannerModel.java`

### Compile to AEM Artifacts
```bash
fuse build
```
Generates:
1. `ui.apps/.../components/<name>/<name>.html` (Production HTL)
2. `ui.apps/.../components/<name>/.content.xml` (Component definitions)
3. `ui.apps/.../components/<name>/_cq_dialog/.content.xml` (Granite Touch UI dialogs)
4. `core/.../<Name>Props.java` (Sling Model props interfaces)
5. `ui.apps/.../clientlib-fuse/` (Clientlibs, CSS, `fuse-loader.js`, and lazy JS chunks)

### Local Dev Preview Server
```bash
fuse dev
```
Starts a local development server at `http://localhost:3000` with HTL rendering and streaming simulation.

---

## 🧪 Testing & Verification

Run TypeScript compiler and test suites:
```bash
npm run build
npm test
npx playwright install chromium --only-shell
npm run test:browser
```

Run Java OSGi runtime test suite:
```bash
cd java/fuse-runtime
mvn test
```
The Java suite covers `StreamContext`, `Await`, `FuseModel`, `StreamServlet`, and `FuseExecutor`. Browser regressions cover split template delivery, concurrent first interactions, numeric state, nested streams, and failed blocks.

---

## Build AEM artifacts

From the repository root:

```bash
npm run build
npm run build -w @acme/acme-site
mvn clean verify
```

The reactor builds the runtime and example OSGi bundles, validates HTL and FileVault packages, and creates `examples/acme-site/all/target/acme-site.all-1.0.0-SNAPSHOT.zip`. The container embeds both bundles and the immutable `ui.apps` package. The structure package is used for validation and excluded from Cloud Manager deployment.

Use `acme/components/page` as the resource type of a page template to enable the client libraries and stream hooks. The example does not install site content, editable templates, or policies. Integrate the generated components into your existing site and its Dispatcher project. See [AEM integration and verification](docs/aem-integration.md) for package installation and the remaining deployment checks.
