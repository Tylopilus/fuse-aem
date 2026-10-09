package dev.fuse.aem.runtime;

import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.models.annotations.injectorspecific.InjectionStrategy;
import org.apache.sling.models.annotations.injectorspecific.OSGiService;
import org.apache.sling.models.annotations.injectorspecific.Self;
import org.apache.sling.models.annotations.injectorspecific.SlingObject;

/**
 * Abstract base class of every generated {@code <Name>Props} Sling Model.
 *
 * <p>Subclasses must be annotated with
 * {@code @Model(adaptables = SlingHttpServletRequest.class, defaultInjectionStrategy = OPTIONAL)};
 * the injection annotations of this class are inherited by Sling Models.</p>
 *
 * <p>Example of user code in a co-located {@code <Name>Model}:</p>
 * <pre>{@code
 * public CompletableFuture<List<Quote>> getQuotes() {
 *     String endpoint = getEndpoint();                  // read dialog props on the request thread
 *     return async("quotes", () -> client.fetch(endpoint)); // no ResourceResolver access inside!
 * }
 * }</pre>
 */
public abstract class FuseModel {

    /** The current (possibly include-wrapped) request. */
    @Self
    protected SlingHttpServletRequest request;

    /** The component resource being rendered. */
    @SlingObject
    protected Resource resource;

    @OSGiService(injectionStrategy = InjectionStrategy.OPTIONAL)
    private FuseExecutor fuseExecutor;

    /**
     * Runs {@code supplier} asynchronously on the {@link FuseExecutor} pool. The returned future is
     * memoised per request + resource path + {@code key}, so the normal render and the later stream
     * re-render of the same component observe the same future (and the supplier runs only once).
     *
     * <p><strong>The supplier must not use the request's {@code ResourceResolver}</strong> (or any
     * object obtained from it, such as {@code Resource}s or {@code ValueMap}s) because resolvers are
     * not thread-safe. Read what you need before calling {@code async}.</p>
     *
     * @param key      key unique within the component (e.g. the getter name)
     * @param supplier the task
     * @param <T>      result type
     * @return the (memoised) future
     */
    protected <T> CompletableFuture<T> async(String key, Supplier<T> supplier) {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(supplier, "supplier");
        FuseExecutor executor = executor();
        if (request == null) {
            // Not adapted from a request (e.g. unit tests): no memoisation possible.
            return executor != null ? executor.supply(supplier) : FuseExecutor.runInline(supplier);
        }
        String memoKey = resourcePath() + '\u0000' + key;
        return StreamContext.get(request).memoize(memoKey,
                () -> executor != null ? executor.supply(supplier) : FuseExecutor.runInline(supplier));
    }

    /**
     * Turns a content path into a link: {@code /content/...} paths without extension are mapped via
     * the resource resolver and get {@code .html} appended; anything else (external URLs, anchors,
     * DAM assets with an extension, ...) is returned unchanged.
     *
     * <p>The mapping is applied to the path <em>including</em> the {@code .html} extension
     * ({@code resolver.map(request, path + ".html")}) so that both prefix-based and
     * extension-aware {@code /etc/map} rules apply. Query strings and fragments are preserved.</p>
     *
     * @param path the path or URL, may be {@code null}
     * @return the link, or {@code null} if {@code path} is {@code null}
     */
    protected String link(String path) {
        if (path == null) {
            return null;
        }
        String trimmed = path.trim();
        if (!trimmed.startsWith("/content/")) {
            return path;
        }
        int tailIndex = indexOfAny(trimmed, '?', '#');
        String pathPart = tailIndex < 0 ? trimmed : trimmed.substring(0, tailIndex);
        String tail = tailIndex < 0 ? "" : trimmed.substring(tailIndex);
        String lastSegment = pathPart.substring(pathPart.lastIndexOf('/') + 1);
        if (lastSegment.isEmpty() || lastSegment.indexOf('.') >= 0) {
            return path;
        }
        String withExtension = pathPart + ".html";
        ResourceResolver resolver = resolver();
        String mapped = withExtension;
        if (resolver != null) {
            String result = request != null ? resolver.map(request, withExtension) : resolver.map(withExtension);
            if (result != null && !result.isEmpty()) {
                mapped = result;
            }
        }
        return mapped + tail;
    }

    /**
     * @return the {@link FuseExecutor} service, or {@code null} if unavailable (async suppliers then
     *         run synchronously)
     */
    protected FuseExecutor executor() {
        return fuseExecutor;
    }

    /**
     * @return path of the component resource ({@code ""} if unknown)
     */
    protected String resourcePath() {
        Resource r = resource != null ? resource : (request != null ? request.getResource() : null);
        return r != null ? r.getPath() : "";
    }

    private ResourceResolver resolver() {
        if (request != null) {
            return request.getResourceResolver();
        }
        return resource != null ? resource.getResourceResolver() : null;
    }

    private static int indexOfAny(String s, char a, char b) {
        int ia = s.indexOf(a);
        int ib = s.indexOf(b);
        if (ia < 0) {
            return ib;
        }
        if (ib < 0) {
            return ia;
        }
        return Math.min(ia, ib);
    }
}
