# ⚡ Fuse: Qwik-Style Single-File Components for AEM as a Cloud Service

**Fuse** is an AEM development framework that solves the fragmentation of modern Adobe Experience Manager (AEMaaCS) projects.

Instead of scattering component code across three disparate modules (`core` for Java Sling Models, `ui.apps` for HTL scripts and Touch UI XML dialogs, and `ui.frontend` for JS/CSS bundles), Fuse lets you author components in **single-file `.tsx` definitions** inspired by **Qwik v2**—featuring fine-grained lazy loading, resumability (zero hydration overhead), and native out-of-order chunked streaming.

---

## 🚀 Key Highlights & Guarantees

1. **Zero Node.js in Production:**
   - Production AEM instances run **100% native AEM artifacts**: HTL templates, Granite/Coral Touch UI dialogs, Sling Models, and standard ClientLibraries.
   - No Node.js SSR sidecar or reverse proxy required.
2. **Resumable & Lazy Client Runtime (~2 KB):**
   - No hydration waterfalls. Event handlers (`onClick$`) are extracted into standalone hash-named micro-chunks and loaded **only when interacted with**.
   - Signals (`useSignal`) update bound DOM nodes directly via fine-grained attribute bindings (`data-fuse-b`).
3. **Out-of-Order Streaming on AEMaaCS:**
   - Long-running async data fetches (e.g. external APIs, stock tickers, commerce catalogs) wrap in `<Await value={model.promise} fallback={...}>`.
   - The initial HTL response immediately streams placeholders (`<fuse-await id="fz-1">`).
   - Background tasks executed by `FuseExecutor` resolve concurrently and flush `<template data-fuse-r="fz-1">` chunks over HTTP chunked transfer encoding, swapped into the DOM seamlessly by `fuse-loader.js`.
4. **Co-located Java Models & Touch UI Dialogs:**
   - Dialog schemas (`dialog({ fields: ... })`) generate standard Granite UI Coral XML dialogs.
   - Generated typed Java `*Props.java` classes adapt from `SlingHttpServletRequest` and `Resource`.
   - Co-located Java business models (e.g. `StockTickerModel.java`) extend `*Props` and compile into the OSGi bundle.
5. **Blazing Fast Local Dev Preview:**
   - Run `fuse dev` for a sub-second inner loop powered by `@adobe/htlengine` that renders actual compiled HTL against mock data and simulates streaming latency without waiting for an AEM SDK restart.

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
*Note: Event listeners (`onClick$`) are bundled into separate hash-named JS chunks and lazy-loaded only on click. Initial count is rendered directly into HTML on the server.*

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
        return async("quotes", () -> fetchLiveQuote(getSymbol()));
    }
}
```

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
```

Run Java OSGi runtime test suite:
```bash
cd java/fuse-runtime
mvn test
```
*(35 unit tests covering `StreamContext`, `Await`, `FuseModel`, `StreamServlet`, and `FuseExecutor`).*

---

## 🚢 Production Deployment to AEM as a Cloud Service

1. **Add `fuse-runtime` dependency to `all/pom.xml` and `core/pom.xml`:**
```xml
<dependency>
    <groupId>dev.fuse.aem</groupId>
    <artifactId>fuse-runtime</artifactId>
    <version>0.1.0-SNAPSHOT</version>
</dependency>
```
2. **Run Maven build:**
```bash
mvn clean install -PautoInstallSinglePackage
```
3. Cloud Manager deploys the standard `.zip` packages to AEMaaCS. No custom Node.js buildpack or runtime is required.
