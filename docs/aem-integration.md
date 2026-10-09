# AEM integration and verification

The repository builds a native AEM container package. A successful build verifies Java compilation, Sling Model and OSGi metadata, HTL syntax, and FileVault packaging. It does not establish that a deployed authoring editor or the Cloud delivery stack behaves correctly.

## Build and install

Use Node.js 20+, JDK 21, and Maven 3.9+ from the repository root:

```bash
npm ci
npm run build
npm run build -w @acme/acme-site
mvn clean verify
```

Install `examples/acme-site/all/target/acme-site.all-1.0.0-SNAPSHOT.zip` through Package Manager on a local AEM Cloud SDK. Check that `dev.fuse.aem.runtime` and `com.acme.acme-site.core` are active OSGi bundles. The runtime bundle registers its servlet, executor, and Sling Models; the core bundle declares `Sling-Model-Packages: com.acme.components`.

The container embeds the runtime bundle, example core bundle, and immutable `ui.apps` package under `/apps/acme-packages/application/install`. Only the container is a Cloud Manager deployment target. The repository structure package provides build-time validation of `/apps` ancestors. This follows [Adobe's package structure guidance](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/aem-project-content-package-structure).

The example installs component code. Create or adapt your site's editable page template and component policy to use `acme/components/page` and allow the example components. The page component inherits Core Page v3, includes the `acme.fuse` client libraries, arms streaming in `customheaderlibs.html`, and includes the stream servlet in `customfooterlibs.html`. If your site has its own page component, copy those hooks into it. Core Components must be installed in the SDK.

Author and save a counter, an accordion with multifield items, and a stock ticker. Verify that values survive a reload and that multiple instances have independent browser state. In edit mode, awaited values render with bounded blocking so the editor sees component markup rather than unresolved placeholders.

## Dispatcher and CDN

Use your site's existing AEM Dispatcher project. Its filters must permit the public HTML pages, the aggregated `/etc.clientlibs/acme/clientlibs/clientlib-fuse.js` and `.css` URLs, and `/etc.clientlibs/acme/clientlibs/clientlib-fuse/resources/chunks/*.js`. Raw loader files are served by the local preview; AEM pages load the aggregated clientlib through AEM's HTL helper. Verify JS MIME types and your CSP's script policy allow the ES module imports.

Chunk filenames hash the bundled content, including dependencies. Keep previous hashed chunks available for the lifetime of cached HTML that refers to them. The compiler retains existing chunks; perform any cleanup together with your site's cache invalidation and deployment retention policy.

Streaming is opt-in through the page hooks. With `?fuse-stream=off`, the Java runtime renders awaited values before returning the page. Use this mode until progressive delivery has been measured through your actual publish hostname. Adobe documents [CDN buffering of SSE responses](https://experienceleague.adobe.com/en/docs/experience-cloud-kcs/kbarticles/ka-41932); that case concerns SSE, but illustrates why servlet flushing alone is insufficient evidence for HTML streaming. Coordinate delivery changes with the configuration supported by your Cloud environment.

For a page with a deliberately slow mock API, capture the response at the local publish instance, through Dispatcher, and through the public CDN:

```bash
curl --no-buffer --trace-time --trace-ascii /tmp/fuse-stream.trace \
  'https://YOUR-PUBLISH-HOST/content/acme/en/test.html'
```

The trace should contain the initial HTML and `<fuse-await>` before the API completes, then the resolved template and its completion marker. Compare the timestamped results with `?fuse-stream=off`. Test a cache miss and a cache hit separately. Cached HTML avoids an origin render, so caching and live data freshness need an explicit site policy; consult [Adobe's caching documentation](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/caching).

Also verify error and timeout fallbacks, disabled JavaScript, interrupted requests, and several simultaneous page requests. The worker pool rejects excess work instead of moving it onto the HTTP thread. Cancellation interrupts worker tasks, but external API clients must configure their own connection and read timeouts. The servlet still occupies an HTTP request thread while waiting; the worker pool does not make Sling rendering asynchronous.

Cloud deployment and these measurements remain integration work. CI builds the installable package and runs local Java, compiler, and Chromium regressions without claiming cloud streaming support.
