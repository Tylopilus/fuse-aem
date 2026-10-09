package dev.fuse.aem.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import org.apache.sling.api.SlingHttpServletRequest;
import org.junit.jupiter.api.Test;

class StreamContextTest {

    @Test
    void getCreatesOnceAndIsSharedAcrossIncludeWrappers() {
        SlingHttpServletRequest page = TestRequests.request("/content/p/jcr:content", "app/page");
        assertNull(StreamContext.peek(page));
        StreamContext ctx = StreamContext.get(page);
        assertSame(ctx, StreamContext.get(page));
        SlingHttpServletRequest include = TestRequests.include(page, "/content/p/jcr:content/root/teaser", "app/teaser");
        assertSame(ctx, StreamContext.peek(include));
        assertSame(ctx, StreamContext.get(include));
    }

    @Test
    void armAndClose() {
        StreamContext ctx = new StreamContext();
        assertFalse(ctx.isArmed());
        ctx.arm();
        assertTrue(ctx.isArmed());
        ctx.close();
        assertFalse(ctx.isArmed());
        assertTrue(ctx.isClosed());
        ctx.arm();
        assertFalse(ctx.isArmed(), "closed context cannot be re-armed");
    }

    @Test
    void idsArePerRequestCounter() {
        StreamContext ctx = new StreamContext();
        assertEquals("fz-1", ctx.nextId());
        assertEquals("fz-2", ctx.nextId());
        assertEquals("fz-1", new StreamContext().nextId());
    }

    @Test
    void registerAndDrainKeepOrder() {
        StreamContext ctx = new StreamContext();
        assertFalse(ctx.hasPending());
        StreamContext.Entry a = entry(ctx, "/a", "aw0");
        StreamContext.Entry b = entry(ctx, "/b", "aw0");
        ctx.register(a);
        ctx.register(b);
        assertTrue(ctx.hasPending());
        List<StreamContext.Entry> drained = ctx.drainPending();
        assertEquals(List.of(a, b), drained);
        assertFalse(ctx.hasPending());
        assertTrue(ctx.drainPending().isEmpty());
    }

    @Test
    void streamTargetIsPerResourceAndKey() {
        StreamContext ctx = new StreamContext();
        StreamContext.Entry e = entry(ctx, "/content/p/jcr:content/root/teaser", "aw1");
        assertNull(ctx.getStreamKey(e.getResourcePath()));

        ctx.beginStream(e, "resolved");
        assertEquals("aw1", ctx.getStreamKey("/content/p/jcr:content/root/teaser"));
        assertNull(ctx.getStreamKey("/content/p/jcr:content/root/teaser/child"));
        assertTrue(ctx.isStreamTarget("/content/p/jcr:content/root/teaser", "aw1"));
        assertFalse(ctx.isStreamTarget("/content/p/jcr:content/root/teaser", "aw0"));
        assertFalse(ctx.isStreamTarget("/content/p/jcr:content/root/teaser", null));
        assertEquals("resolved", ctx.getTargetValue());
        assertEquals("resolved", ctx.getResolvedValue(e.getId()));

        ctx.endStream();
        assertNull(ctx.getStreamKey("/content/p/jcr:content/root/teaser"));
        assertNull(ctx.getTargetValue());
        assertNull(ctx.getResolvedValue(e.getId()));
    }

    @Test
    void memoizeCreatesOnceAndAllowsReentrancy() {
        StreamContext ctx = new StreamContext();
        AtomicInteger calls = new AtomicInteger();
        CompletableFuture<String> first = ctx.memoize("k", () -> {
            calls.incrementAndGet();
            // re-entrant use from inside the factory must not fail
            ctx.memoize("inner", () -> CompletableFuture.completedFuture(1));
            return CompletableFuture.completedFuture("v");
        });
        CompletableFuture<String> second = ctx.memoize("k", () -> {
            calls.incrementAndGet();
            return CompletableFuture.completedFuture("other");
        });
        assertSame(first, second);
        assertEquals(1, calls.get());
    }

    @Test
    void deadlineIsFixedOnFirstCall() {
        StreamContext ctx = new StreamContext();
        long d1 = ctx.deadlineNanos(1000);
        long d2 = ctx.deadlineNanos(999_999);
        assertEquals(d1, d2);
        assertTrue(ctx.remainingMillis(0) <= 1000);
        StreamContext expired = new StreamContext();
        assertEquals(0, expired.remainingMillis(0));
    }

    private static StreamContext.Entry entry(StreamContext ctx, String path, String key) {
        return new StreamContext.Entry(ctx.nextId(), new CompletableFuture<>(), path, "app/teaser", key);
    }
}
