package dev.fuse.aem.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.annotation.Annotation;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

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
}
