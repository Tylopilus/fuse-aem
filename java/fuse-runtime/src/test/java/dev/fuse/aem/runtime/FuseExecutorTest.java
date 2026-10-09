package dev.fuse.aem.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.annotation.Annotation;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;

class FuseExecutorTest {

    private static FuseExecutor.Config config(int threads, long timeoutMs) {
        return new FuseExecutor.Config() {
            @Override
            public Class<? extends Annotation> annotationType() {
                return FuseExecutor.Config.class;
            }

            @Override
            public int threads() {
                return threads;
            }

            @Override
            public long timeoutMs() {
                return timeoutMs;
            }

            @Override
            public int queueSize() {
                return 10;
            }
        };
    }

    @Test
    void runsOnPoolThreadsAndPropagatesFailures() {
        FuseExecutor executor = new FuseExecutor();
        executor.activate(config(2, 1234));
        try {
            assertEquals(1234, executor.getTimeoutMs());
            String caller = Thread.currentThread().getName();
            String worker = executor.supply(() -> Thread.currentThread().getName()).join();
            assertNotEquals(caller, worker);
            assertTrue(worker.startsWith("fuse-executor-"));

            CompletableFuture<Object> failing = executor.supply(() -> {
                throw new IllegalStateException("x");
            });
            assertThrows(CompletionException.class, failing::join);
        } finally {
            executor.deactivate();
        }
    }

    @Test
    void runsInlineWhenNotActive() {
        FuseExecutor executor = new FuseExecutor();
        assertEquals(FuseExecutor.DEFAULT_TIMEOUT_MS, executor.getTimeoutMs());
        String caller = Thread.currentThread().getName();
        assertEquals(caller, executor.supply(() -> Thread.currentThread().getName()).join());
        executor.activate(config(1, 10));
        executor.deactivate();
        assertEquals(caller, executor.supply(() -> Thread.currentThread().getName()).join());
    }

    @Test
    void rejectsSaturatedPoolWithoutRunningSupplierOnCaller() throws Exception {
        FuseExecutor executor = new FuseExecutor();
        executor.activate(config(1, 5000));
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try {
            executor.supply(() -> {
                started.countDown();
                try { release.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                return null;
            });
            assertTrue(started.await(2, TimeUnit.SECONDS));
            for (int i = 0; i < 10; i++) executor.supply(() -> null);
            AtomicBoolean ran = new AtomicBoolean();
            CompletableFuture<Object> rejected = executor.supply(() -> { ran.set(true); return null; });
            assertTrue(rejected.isCompletedExceptionally());
            assertThrows(CompletionException.class, rejected::join);
            assertEquals(false, ran.get());
        } finally { release.countDown(); executor.deactivate(); }
    }

    @Test
    void cancellingFutureInterruptsTheWorkerAndFreesCapacity() throws Exception {
        FuseExecutor executor = new FuseExecutor();
        executor.activate(config(1, 5000));
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try {
            CompletableFuture<Object> pending = executor.supply(() -> {
                started.countDown();
                try { release.await(); } catch (InterruptedException e) {
                    interrupted.countDown();
                    Thread.currentThread().interrupt();
                }
                return null;
            });
            assertTrue(started.await(2, TimeUnit.SECONDS));
            pending.cancel(true);
            assertTrue(interrupted.await(2, TimeUnit.SECONDS));
            assertEquals("next", executor.supply(() -> "next").get(2, TimeUnit.SECONDS));
        } finally { release.countDown(); executor.deactivate(); }
    }
}
