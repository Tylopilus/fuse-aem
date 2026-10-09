package dev.fuse.aem.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;

class StreamServletTest {

    /** Records written chunks; each flush closes a chunk. */
    static class RecordingSink implements StreamServlet.Sink {
        final List<String> chunks = new ArrayList<>();
        final StringBuilder current = new StringBuilder();
        int flushes;

        @Override
        public void write(String s) {
            current.append(s);
        }

        @Override
        public void flush() {
            flushes++;
            if (current.length() > 0) {
                chunks.add(current.toString());
                current.setLength(0);
            }
        }
    }

    private static long deadline(long ms) {
        return System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ms);
    }

    private static StreamContext.Entry register(StreamContext ctx, CompletableFuture<?> f, String key) {
        StreamContext.Entry e = new StreamContext.Entry(ctx.nextId(), f, "/content/p/jcr:content/c-" + key,
                "acme/components/c", key);
        ctx.register(e);
        return e;
    }

    @Test
    void streamsInCompletionOrderAndSetsTarget() {
        StreamContext ctx = new StreamContext();
        ctx.arm();
        CompletableFuture<String> slow = new CompletableFuture<>();
        CompletableFuture<String> fast = new CompletableFuture<>();
        register(ctx, slow, "aw0");
        register(ctx, fast, "aw1");
        CompletableFuture.runAsync(() -> {
            fast.complete("F");
            sleep(30);
            slow.complete("S");
        });

        RecordingSink sink = new RecordingSink();
        StreamServlet.stream(ctx, deadline(2000), sink, (entry, value) -> {
            // during rendering the stream target is the entry
            assertEquals(entry.getKey(), ctx.getStreamKey(entry.getResourcePath()));
            return "<p>" + ctx.getTargetValue() + "</p>";
        });

        assertEquals(List.of(
                "<template data-fuse-r=\"fz-2\"><p>F</p></template>",
                "<template data-fuse-r=\"fz-1\"><p>S</p></template>"), sink.chunks);
        assertTrue(sink.flushes >= 3, "initial flush + one per chunk");
        assertTrue(ctx.isClosed());
        assertFalse(ctx.isArmed());
    }

    @Test
    void failedFutureAndRenderErrorProduceErrorTemplates() {
        StreamContext ctx = new StreamContext();
        CompletableFuture<String> failed = new CompletableFuture<>();
        failed.completeExceptionally(new RuntimeException("boom"));
        register(ctx, failed, "aw0");
        register(ctx, CompletableFuture.completedFuture("x"), "aw1");
        register(ctx, CompletableFuture.completedFuture("y"), "aw2");

        RecordingSink sink = new RecordingSink();
        StreamServlet.stream(ctx, deadline(1000), sink, (entry, value) -> {
            if ("aw1".equals(entry.getKey())) {
                throw new IllegalStateException("render failed");
            }
            return String.valueOf(value);
        });

        assertEquals(List.of(
                "<template data-fuse-r=\"fz-1\" data-fuse-error></template>",
                "<template data-fuse-r=\"fz-2\" data-fuse-error></template>",
                "<template data-fuse-r=\"fz-3\">y</template>"), sink.chunks);
    }

    @Test
    void timedOutEntriesAreCancelledAndMarked() {
        StreamContext ctx = new StreamContext();
        CompletableFuture<String> never = new CompletableFuture<>();
        register(ctx, never, "aw0");
        register(ctx, CompletableFuture.completedFuture("ok"), "aw1");

        RecordingSink sink = new RecordingSink();
        long start = System.nanoTime();
        StreamServlet.stream(ctx, deadline(100), sink, (entry, value) -> String.valueOf(value));
        long tookMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

        assertEquals("<template data-fuse-r=\"fz-2\">ok</template>", sink.chunks.get(0));
        assertEquals("<template data-fuse-r=\"fz-1\" data-fuse-error></template>", sink.chunks.get(1));
        assertTrue(never.isCancelled());
        assertTrue(tookMs < 1500, "bounded by the deadline");
    }

    @Test
    void entriesRegisteredDuringRenderingAreStreamedToo() {
        StreamContext ctx = new StreamContext();
        ctx.arm();
        register(ctx, CompletableFuture.completedFuture("outer"), "aw0");
        CompletableFuture<String> nested = new CompletableFuture<>();

        RecordingSink sink = new RecordingSink();
        StreamServlet.stream(ctx, deadline(2000), sink, (entry, value) -> {
            if ("aw0".equals(entry.getKey())) {
                StreamContext.Entry inner = register(ctx, nested, "aw1");
                CompletableFuture.runAsync(() -> {
                    sleep(20);
                    nested.complete("inner");
                });
                return "<fuse-await id=\"" + inner.getId() + "\">…</fuse-await>";
            }
            return String.valueOf(value);
        });

        assertEquals(List.of(
                "<template data-fuse-r=\"fz-1\"><fuse-await id=\"fz-2\">…</fuse-await></template>",
                "<template data-fuse-r=\"fz-2\">inner</template>"), sink.chunks);
    }

    @Test
    void clientGoneStopsStreaming() {
        StreamContext ctx = new StreamContext();
        CompletableFuture<String> pending = new CompletableFuture<>();
        register(ctx, CompletableFuture.completedFuture("a"), "aw0");
        register(ctx, pending, "aw1");
        List<String> written = new ArrayList<>();
        StreamServlet.Sink broken = new StreamServlet.Sink() {
            @Override
            public void write(String s) throws IOException {
                written.add(s);
                throw new IOException("closed");
            }

            @Override
            public void flush() {
            }
        };
        StreamServlet.stream(ctx, deadline(5000), broken, (entry, value) -> "x");
        assertEquals(1, written.size());
        assertTrue(pending.isCancelled());
        assertTrue(ctx.isClosed());
    }

    @Test
    void nothingPendingWritesNothing() {
        StreamContext ctx = new StreamContext();
        RecordingSink sink = new RecordingSink();
        StreamServlet.stream(ctx, deadline(100), sink, (entry, value) -> "x");
        assertTrue(sink.chunks.isEmpty());
        assertTrue(ctx.isClosed());
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
