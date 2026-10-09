package dev.fuse.aem.runtime;

import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import javax.annotation.PostConstruct;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.InjectionStrategy;
import org.apache.sling.models.annotations.injectorspecific.OSGiService;
import org.apache.sling.models.annotations.injectorspecific.RequestAttribute;
import org.apache.sling.models.annotations.injectorspecific.Self;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.day.cq.wcm.api.WCMMode;

/**
 * Use-object behind an {@code <Await>} block:
 * {@code data-sly-use.aw0="${'dev.fuse.aem.runtime.Await' @ key='aw0', value=m.quotes}"}.
 *
 * <p>HTL passes the use parameters {@code key} and {@code value} to Sling Models as request
 * attributes.</p>
 *
 * <p>Algorithm (see contract.md):</p>
 * <ol>
 *   <li>stream re-render of this resource + key &rarr; resolved value, not pending;</li>
 *   <li>value is not a future &rarr; as-is, not pending;</li>
 *   <li>future already done &rarr; its value ({@code null} on failure), not pending;</li>
 *   <li>streaming not armed, WCM mode not {@code DISABLED}, no key, or not a
 *       {@link CompletableFuture}/{@link CompletionStage} &rarr; block until the global deadline,
 *       not pending ({@code null} on timeout/failure);</li>
 *   <li>otherwise register with {@link StreamContext}, pending with id {@code fz-<n>}.</li>
 * </ol>
 */
@Model(adaptables = SlingHttpServletRequest.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class Await {

    private static final Logger LOG = LoggerFactory.getLogger(Await.class);

    @Self
    SlingHttpServletRequest request;

    @RequestAttribute(name = "key")
    String key;

    @RequestAttribute(name = "value")
    Object value;

    @OSGiService(injectionStrategy = InjectionStrategy.OPTIONAL)
    FuseExecutor executor;

    private boolean pending;
    private String id;
    private Object resolvedValue;

    @PostConstruct
    void init() {
        if (request == null) {
            resolvedValue = value instanceof Future ? null : value;
            return;
        }
        StreamContext ctx = StreamContext.get(request);
        Resource resource = request.getResource();
        String resourcePath = resource != null ? resource.getPath() : null;

        // 1. Stream re-render of this resource + key.
        if (resourcePath != null && ctx.isStreamTarget(resourcePath, key)) {
            resolvedValue = ctx.getTargetValue();
            return;
        }

        // 2. Plain value.
        CompletableFuture<?> future = asCompletableFuture(value);
        if (future == null && !(value instanceof Future)) {
            resolvedValue = value;
            return;
        }

        // 3. Already done.
        if (future != null && future.isDone()) {
            resolvedValue = joinQuietly(future);
            return;
        }

        // 4. Block (with the global deadline).
        boolean canStream = future != null
                && key != null
                && resourcePath != null
                && ctx.isArmed()
                && WCMMode.fromRequest(request) == WCMMode.DISABLED;
        if (!canStream) {
            resolvedValue = await((Future<?>) value, ctx.remainingMillis(timeoutMs()));
            return;
        }

        // 5. Register for streaming.
        id = ctx.nextId();
        ctx.register(new StreamContext.Entry(id, future, resourcePath,
                resource.getResourceType(), key));
        pending = true;
    }

    /**
     * @return {@code true} if the block is rendered as a {@code <fuse-await>} placeholder and will be
     *         streamed later
     */
    public boolean isPending() {
        return pending;
    }

    /**
     * @return the resolved value ({@code null} while pending, on failure or on timeout)
     */
    public Object getValue() {
        return resolvedValue;
    }

    /**
     * @return the placeholder id ({@code fz-<n>}) if pending, otherwise {@code null}
     */
    public String getId() {
        return id;
    }

    private long timeoutMs() {
        return executor != null ? executor.getTimeoutMs() : FuseExecutor.DEFAULT_TIMEOUT_MS;
    }

    private static CompletableFuture<?> asCompletableFuture(Object value) {
        if (value instanceof CompletableFuture) {
            return (CompletableFuture<?>) value;
        }
        if (value instanceof CompletionStage) {
            try {
                return ((CompletionStage<?>) value).toCompletableFuture();
            } catch (UnsupportedOperationException e) {
                return null;
            }
        }
        return null;
    }

    private static Object joinQuietly(CompletableFuture<?> future) {
        try {
            return future.join();
        } catch (CompletionException | CancellationException e) {
            LOG.warn("Awaited value failed", e.getCause() != null ? e.getCause() : e);
            return null;
        }
    }

    private static Object await(Future<?> future, long timeoutMs) {
        try {
            return future.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            LOG.warn("Awaited value timed out");
            return null;
        } catch (ExecutionException e) {
            LOG.warn("Awaited value failed", e.getCause());
            return null;
        } catch (CancellationException e) {
            LOG.warn("Awaited value was cancelled");
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }
}
