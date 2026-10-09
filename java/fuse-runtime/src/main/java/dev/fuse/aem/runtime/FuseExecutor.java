package dev.fuse.aem.runtime;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Modified;
import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.Designate;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Bounded thread pool used to run {@link FuseModel#async(String, Supplier)} suppliers, plus the
 * global streaming timeout.
 *
 * <p>OSGi configuration PID: {@code dev.fuse.aem.runtime.FuseExecutor}.</p>
 *
 * <p>If the pool is saturated (queue full) or shut down, the supplier runs synchronously on the
 * calling thread so that returned futures always complete.</p>
 */
@Component(service = FuseExecutor.class, immediate = true)
@Designate(ocd = FuseExecutor.Config.class)
public class FuseExecutor {

    private static final Logger LOG = LoggerFactory.getLogger(FuseExecutor.class);

    /** Default number of worker threads. */
    public static final int DEFAULT_THREADS = 8;
    /** Default global timeout in milliseconds. */
    public static final long DEFAULT_TIMEOUT_MS = 5000L;
    /** Default task queue capacity. */
    public static final int DEFAULT_QUEUE_SIZE = 1000;

    /** OSGi metatype configuration. */
    @ObjectClassDefinition(
            name = "Fuse Executor",
            description = "Thread pool and timeout for asynchronous data loading of Fuse components "
                    + "(FuseModel.async / <Await>).")
    public @interface Config {

        /** @return pool size */
        @AttributeDefinition(name = "Threads", description = "Number of worker threads.", min = "1")
        int threads() default DEFAULT_THREADS;

        /** @return timeout */
        @AttributeDefinition(name = "Timeout (ms)",
                description = "Global per-request deadline for awaited values. Blocks not resolved in "
                        + "time keep their fallback (streaming) or render with an empty value (blocking).",
                min = "0")
        long timeoutMs() default DEFAULT_TIMEOUT_MS;

        /** @return queue size */
        @AttributeDefinition(name = "Queue size",
                description = "Maximum number of queued tasks. When full, tasks run on the request thread.",
                min = "1")
        int queueSize() default DEFAULT_QUEUE_SIZE;
    }

    private static final AtomicInteger POOL_COUNTER = new AtomicInteger();

    private volatile ThreadPoolExecutor pool;
    private volatile long timeoutMs = DEFAULT_TIMEOUT_MS;

    /**
     * Activates (or re-configures) the service.
     *
     * @param config the configuration
     */
    @Activate
    @Modified
    protected void activate(Config config) {
        int threads = Math.max(1, config.threads());
        int queueSize = Math.max(1, config.queueSize());
        ThreadPoolExecutor previous = pool;
        pool = createPool(threads, queueSize);
        timeoutMs = Math.max(0L, config.timeoutMs());
        if (previous != null) {
            previous.shutdown();
        }
        LOG.info("Fuse executor started: threads={}, queueSize={}, timeoutMs={}", threads, queueSize, timeoutMs);
    }

    /** Shuts the pool down. Running tasks may finish; queued tasks are dropped after a grace period. */
    @Deactivate
    protected void deactivate() {
        ThreadPoolExecutor current = pool;
        pool = null;
        if (current == null) {
            return;
        }
        current.shutdown();
        try {
            if (!current.awaitTermination(2, TimeUnit.SECONDS)) {
                current.shutdownNow();
            }
        } catch (InterruptedException e) {
            current.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Runs {@code supplier} on the pool.
     *
     * @param supplier the task; must not use the request's {@code ResourceResolver}
     * @param <T>      result type
     * @return a future completed with the supplier's result or exception
     */
    public <T> CompletableFuture<T> supply(Supplier<T> supplier) {
        ThreadPoolExecutor current = pool;
        if (current != null) {
            try {
                return CompletableFuture.supplyAsync(supplier, current);
            } catch (RejectedExecutionException e) {
                LOG.debug("Fuse executor saturated or shut down, running task on caller thread");
            }
        }
        return runInline(supplier);
    }

    /**
     * @return the configured global timeout in milliseconds
     */
    public long getTimeoutMs() {
        return timeoutMs;
    }

    /**
     * Runs a supplier on the calling thread and wraps the outcome in a completed future.
     *
     * @param supplier the task
     * @param <T>      result type
     * @return a completed future
     */
    static <T> CompletableFuture<T> runInline(Supplier<T> supplier) {
        CompletableFuture<T> future = new CompletableFuture<>();
        try {
            future.complete(supplier.get());
        } catch (Throwable t) { // NOSONAR - propagated through the future
            future.completeExceptionally(t);
        }
        return future;
    }

    private static ThreadPoolExecutor createPool(int threads, int queueSize) {
        int poolId = POOL_COUNTER.incrementAndGet();
        AtomicInteger threadCounter = new AtomicInteger();
        ThreadFactory factory = runnable -> {
            Thread t = new Thread(runnable, "fuse-executor-" + poolId + "-" + threadCounter.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
        ThreadPoolExecutor executor = new ThreadPoolExecutor(threads, threads, 60L, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(queueSize), factory, new ThreadPoolExecutor.AbortPolicy());
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }
}
