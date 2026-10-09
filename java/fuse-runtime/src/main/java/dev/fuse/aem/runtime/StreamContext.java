package dev.fuse.aem.runtime;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import javax.servlet.ServletRequest;

/**
 * Per-request state shared between the Fuse use-objects ({@link Await}, {@link FuseContext},
 * {@link PageStream}), {@link FuseModel#async(String, Supplier)} and the {@link StreamServlet}.
 *
 * <p>The instance is stored as request attribute {@link #ATTRIBUTE}. Request attributes are shared
 * by all request wrappers created for includes, so every component rendered as part of the same
 * page request sees the same instance.</p>
 *
 * <h2>Threading</h2>
 * <p>All state except the futures themselves is only touched by the request thread. Futures are
 * completed on {@link FuseExecutor} threads; the request thread only observes them. Methods are
 * nevertheless synchronized (and the memo map is concurrent) so that the object stays consistent
 * even if user code touches it from another thread.</p>
 */
public final class StreamContext {

    /** Name of the request attribute holding the instance. */
    public static final String ATTRIBUTE = StreamContext.class.getName();

    /** Prefix of placeholder ids ({@code fz-1}, {@code fz-2}, ...). */
    public static final String ID_PREFIX = "fz-";

    private boolean armed;
    private boolean closed;
    private int counter;
    private long deadlineNanos;
    private boolean deadlineSet;

    /** Registered but not yet streamed entries, in registration order. */
    private final List<Entry> pending = new ArrayList<>();
    /** Resolved values by placeholder id (filled by the stream servlet before re-rendering). */
    private final Map<String, Object> resolved = new HashMap<>();
    /** Memoised futures created by {@link FuseModel#async(String, Supplier)}. */
    private final ConcurrentMap<String, CompletableFuture<?>> memo = new ConcurrentHashMap<>();

    /** The resource / Await key currently being stream-rendered, or {@code null}. */
    private Target target;

    /** Use {@link #get(ServletRequest)}. Package-private for tests. */
    StreamContext() {
    }

    // ------------------------------------------------------------------------------------------
    // Lookup
    // ------------------------------------------------------------------------------------------

    /**
     * Returns the context of the given request, creating and storing it if necessary.
     *
     * @param request the (possibly wrapped) request
     * @return the shared context, never {@code null}
     */
    public static StreamContext get(ServletRequest request) {
        Objects.requireNonNull(request, "request");
        Object existing = request.getAttribute(ATTRIBUTE);
        if (existing instanceof StreamContext) {
            return (StreamContext) existing;
        }
        StreamContext created = new StreamContext();
        request.setAttribute(ATTRIBUTE, created);
        return created;
    }

    /**
     * Returns the context of the given request without creating one.
     *
     * @param request the (possibly wrapped) request
     * @return the context, or {@code null} if none was created yet
     */
    public static StreamContext peek(ServletRequest request) {
        if (request == null) {
            return null;
        }
        Object existing = request.getAttribute(ATTRIBUTE);
        return existing instanceof StreamContext ? (StreamContext) existing : null;
    }

    // ------------------------------------------------------------------------------------------
    // Arming
    // ------------------------------------------------------------------------------------------

    /**
     * Arms out-of-order streaming for this request (called by {@link PageStream}). Has no effect
     * once the context was {@linkplain #close() closed}.
     */
    public synchronized void arm() {
        if (!closed) {
            armed = true;
        }
    }

    /**
     * @return {@code true} if {@link Await} may register pending entries instead of blocking
     */
    public synchronized boolean isArmed() {
        return armed && !closed;
    }

    /**
     * Disarms streaming permanently. Called by the {@link StreamServlet} when it is done, so that
     * {@link Await}s rendered afterwards block instead of leaving unresolvable placeholders.
     */
    public synchronized void close() {
        closed = true;
        armed = false;
    }

    /**
     * @return {@code true} once {@link #close()} was called
     */
    public synchronized boolean isClosed() {
        return closed;
    }

    // ------------------------------------------------------------------------------------------
    // Deadline
    // ------------------------------------------------------------------------------------------

    /**
     * Returns the global deadline of this request (in {@link System#nanoTime()} units). The deadline
     * is fixed on the first call as "now + {@code timeoutMs}"; later calls return the same value.
     *
     * @param timeoutMs timeout used if the deadline is not fixed yet
     * @return the deadline in nano time
     */
    public synchronized long deadlineNanos(long timeoutMs) {
        if (!deadlineSet) {
            deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(Math.max(0L, timeoutMs));
            deadlineSet = true;
        }
        return deadlineNanos;
    }

    /**
     * Milliseconds left until the {@linkplain #deadlineNanos(long) deadline} (never negative).
     *
     * @param timeoutMs timeout used if the deadline is not fixed yet
     * @return remaining milliseconds, {@code 0} if the deadline has passed
     */
    public long remainingMillis(long timeoutMs) {
        long remaining = deadlineNanos(timeoutMs) - System.nanoTime();
        return remaining <= 0 ? 0L : TimeUnit.NANOSECONDS.toMillis(remaining);
    }

    // ------------------------------------------------------------------------------------------
    // Pending entries
    // ------------------------------------------------------------------------------------------

    /**
     * @return the next placeholder id of this request: {@code fz-1}, {@code fz-2}, ...
     */
    public synchronized String nextId() {
        counter++;
        return ID_PREFIX + counter;
    }

    /**
     * Registers a pending entry to be streamed by the {@link StreamServlet}.
     *
     * @param entry the entry
     */
    public synchronized void register(Entry entry) {
        pending.add(Objects.requireNonNull(entry, "entry"));
    }

    /**
     * @return {@code true} if entries are waiting to be picked up by the stream servlet
     */
    public synchronized boolean hasPending() {
        return !pending.isEmpty();
    }

    /**
     * Removes and returns all registered entries (in registration order).
     *
     * @return the entries registered since the last call, never {@code null}
     */
    public synchronized List<Entry> drainPending() {
        if (pending.isEmpty()) {
            return Collections.emptyList();
        }
        List<Entry> copy = new ArrayList<>(pending);
        pending.clear();
        return copy;
    }

    // ------------------------------------------------------------------------------------------
    // Stream target
    // ------------------------------------------------------------------------------------------

    /**
     * Marks {@code entry} as the block currently being stream-rendered and stores its resolved
     * value.
     *
     * @param entry the entry being re-rendered
     * @param value the resolved value of its future
     */
    public synchronized void beginStream(Entry entry, Object value) {
        Objects.requireNonNull(entry, "entry");
        resolved.put(entry.getId(), value);
        target = new Target(entry.getResourcePath(), entry.getKey(), entry.getId());
    }

    /** Clears the current stream target (the resolved value is dropped as well). */
    public synchronized void endStream() {
        if (target != null) {
            resolved.remove(target.id);
        }
        target = null;
    }

    /**
     * @param resourcePath path of the resource being rendered
     * @return the Await key being stream-rendered for that resource, otherwise {@code null}
     */
    public synchronized String getStreamKey(String resourcePath) {
        if (target == null || resourcePath == null) {
            return null;
        }
        return target.resourcePath.equals(resourcePath) ? target.key : null;
    }

    /**
     * @param resourcePath path of the resource being rendered
     * @param key          Await key
     * @return {@code true} if that resource + key is the current stream target
     */
    public synchronized boolean isStreamTarget(String resourcePath, String key) {
        return key != null && key.equals(getStreamKey(resourcePath));
    }

    /**
     * @return the resolved value of the current stream target, or {@code null}
     */
    public synchronized Object getTargetValue() {
        return target == null ? null : resolved.get(target.id);
    }

    /**
     * @param id placeholder id
     * @return the resolved value stored for {@code id}, or {@code null}
     */
    public synchronized Object getResolvedValue(String id) {
        return resolved.get(id);
    }

    // ------------------------------------------------------------------------------------------
    // Memoisation
    // ------------------------------------------------------------------------------------------

    /**
     * Returns the future memoised under {@code memoKey}, creating it with {@code factory} on first
     * use. The factory is invoked outside of any lock, so it may itself call {@code memoize}.
     *
     * @param memoKey key (request scope is implicit)
     * @param factory creates the future
     * @param <T>     value type
     * @return the memoised future
     */
    @SuppressWarnings("unchecked")
    public <T> CompletableFuture<T> memoize(String memoKey, Supplier<CompletableFuture<T>> factory) {
        CompletableFuture<?> existing = memo.get(memoKey);
        if (existing != null) {
            return (CompletableFuture<T>) existing;
        }
        CompletableFuture<T> created = Objects.requireNonNull(factory.get(), "factory returned null");
        CompletableFuture<?> previous = memo.putIfAbsent(memoKey, created);
        return previous != null ? (CompletableFuture<T>) previous : created;
    }

    // ------------------------------------------------------------------------------------------
    // Value types
    // ------------------------------------------------------------------------------------------

    /** A pending {@code <Await>} block waiting to be streamed. Immutable. */
    public static final class Entry {
        private final String id;
        private final CompletableFuture<?> future;
        private final String resourcePath;
        private final String resourceType;
        private final String key;

        /**
         * @param id           placeholder id ({@code fz-<n>})
         * @param future       the future whose value the block renders
         * @param resourcePath path of the component resource to re-render
         * @param resourceType resource type to force when re-rendering
         * @param key          Await key within the component
         */
        public Entry(String id, CompletableFuture<?> future, String resourcePath, String resourceType,
                String key) {
            this.id = Objects.requireNonNull(id, "id");
            this.future = Objects.requireNonNull(future, "future");
            this.resourcePath = Objects.requireNonNull(resourcePath, "resourcePath");
            this.resourceType = resourceType;
            this.key = Objects.requireNonNull(key, "key");
        }

        /** @return placeholder id */
        public String getId() {
            return id;
        }

        /** @return the future to wait for */
        public CompletableFuture<?> getFuture() {
            return future;
        }

        /** @return component resource path */
        public String getResourcePath() {
            return resourcePath;
        }

        /** @return component resource type (may be {@code null}) */
        public String getResourceType() {
            return resourceType;
        }

        /** @return Await key */
        public String getKey() {
            return key;
        }

        @Override
        public String toString() {
            return "Entry[" + id + ", " + resourcePath + " (" + resourceType + "), key=" + key + "]";
        }
    }

    /** The block currently being re-rendered by the stream servlet. */
    private static final class Target {
        final String resourcePath;
        final String key;
        final String id;

        Target(String resourcePath, String key, String id) {
            this.resourcePath = resourcePath;
            this.key = key;
            this.id = id;
        }
    }
}
