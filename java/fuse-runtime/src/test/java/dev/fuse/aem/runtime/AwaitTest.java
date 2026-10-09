package dev.fuse.aem.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;

import org.apache.sling.api.SlingHttpServletRequest;
import org.junit.jupiter.api.Test;

import com.day.cq.wcm.api.WCMMode;

class AwaitTest {

    private static final String PATH = "/content/site/en/jcr:content/root/quotes";
    private static final String TYPE = "acme/components/quotes";

    private final SlingHttpServletRequest request = TestRequests.request(PATH, TYPE);

    private Await await(String key, Object value) {
        return await(request, key, value);
    }

    private static Await await(SlingHttpServletRequest req, String key, Object value) {
        Await aw = new Await();
        aw.request = req;
        aw.key = key;
        aw.value = value;
        FuseExecutor executor = mock(FuseExecutor.class);
        when(executor.getTimeoutMs()).thenReturn(200L);
        aw.executor = executor;
        aw.init();
        return aw;
    }

    private StreamContext armed() {
        StreamContext ctx = StreamContext.get(request);
        ctx.arm();
        return ctx;
    }

    @Test
    void plainValueIsReturnedAsIs() {
        armed();
        List<String> list = List.of("a");
        Await aw = await("aw0", list);
        assertFalse(aw.isPending());
        assertSame(list, aw.getValue());
        assertNull(aw.getId());
    }

    @Test
    void nullValue() {
        Await aw = await("aw0", null);
        assertFalse(aw.isPending());
        assertNull(aw.getValue());
    }

    @Test
    void doneFutureIsJoined() {
        armed();
        Await aw = await("aw0", CompletableFuture.completedFuture("done"));
        assertFalse(aw.isPending());
        assertEquals("done", aw.getValue());
    }

    @Test
    void failedDoneFutureGivesNull() {
        armed();
        CompletableFuture<String> failed = new CompletableFuture<>();
        failed.completeExceptionally(new IllegalStateException("boom"));
        Await aw = await("aw0", failed);
        assertFalse(aw.isPending());
        assertNull(aw.getValue());
    }

    @Test
    void notArmedBlocksUntilResolved() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            CompletableFuture<String> f = CompletableFuture.supplyAsync(() -> {
                sleep(50);
                return "late";
            }, pool);
            Await aw = await("aw0", f);
            assertFalse(aw.isPending());
            assertEquals("late", aw.getValue());
            assertFalse(StreamContext.get(request).hasPending());
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void notArmedTimesOutWithNull() {
        Await aw = await("aw0", new CompletableFuture<String>());
        assertFalse(aw.isPending());
        assertNull(aw.getValue());
    }

    @Test
    void editModeBlocksEvenWhenArmed() {
        armed();
        request.setAttribute(WCMMode.REQUEST_ATTRIBUTE_NAME, WCMMode.EDIT);
        CompletableFuture<String> f = new CompletableFuture<>();
        Await aw = await("aw0", f);
        assertFalse(aw.isPending());
        assertNull(aw.getValue());
        assertFalse(StreamContext.get(request).hasPending());
    }

    @Test
    void armedRegistersPendingEntry() {
        StreamContext ctx = armed();
        CompletableFuture<String> f = new CompletableFuture<>();
        Await aw = await("aw0", f);
        assertTrue(aw.isPending());
        assertEquals("fz-1", aw.getId());
        assertNull(aw.getValue());

        Await second = await("aw1", new CompletableFuture<String>());
        assertEquals("fz-2", second.getId());

        List<StreamContext.Entry> entries = ctx.drainPending();
        assertEquals(2, entries.size());
        StreamContext.Entry e = entries.get(0);
        assertEquals("fz-1", e.getId());
        assertSame(f, e.getFuture());
        assertEquals(PATH, e.getResourcePath());
        assertEquals(TYPE, e.getResourceType());
        assertEquals("aw0", e.getKey());
    }

    @Test
    void armedWithoutKeyBlocks() {
        armed();
        Await aw = await(null, new CompletableFuture<String>());
        assertFalse(aw.isPending());
        assertFalse(StreamContext.get(request).hasPending());
    }

    @Test
    void plainFutureIsBlockedOn() throws Exception {
        armed();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<String> f = pool.submit(() -> "plain");
            Await aw = await("aw0", f);
            assertFalse(aw.isPending());
            assertEquals("plain", aw.getValue());
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void streamRenderUsesResolvedValue() {
        StreamContext ctx = armed();
        StreamContext.Entry entry = new StreamContext.Entry("fz-7", new CompletableFuture<>(), PATH, TYPE, "aw0");
        ctx.beginStream(entry, "resolved");
        try {
            // during the stream re-render the value param is absent
            Await aw = await("aw0", null);
            assertFalse(aw.isPending());
            assertEquals("resolved", aw.getValue());

            // another key of the same resource is not the target
            Await other = await("aw1", "x");
            assertEquals("x", other.getValue());

            // a nested component (different path) is not the target either
            SlingHttpServletRequest nested = TestRequests.include(request, PATH + "/child", TYPE);
            Await nestedAw = await(nested, "aw0", "nested");
            assertEquals("nested", nestedAw.getValue());
        } finally {
            ctx.endStream();
        }
    }

    @Test
    void closedContextBlocks() {
        StreamContext ctx = armed();
        ctx.close();
        Await aw = await("aw0", new CompletableFuture<String>());
        assertFalse(aw.isPending());
        assertFalse(ctx.hasPending());
    }

    @Test
    void fuseContextReportsStreamKeyAndEditMode() {
        StreamContext ctx = armed();
        FuseContext fz = new FuseContext();
        fz.request = request;
        fz.init();
        assertNull(fz.getStreamKey());
        assertFalse(fz.isEditMode());

        ctx.beginStream(new StreamContext.Entry("fz-1", new CompletableFuture<>(), PATH, TYPE, "aw3"), 1);
        FuseContext streaming = new FuseContext();
        streaming.request = request;
        streaming.init();
        assertEquals("aw3", streaming.getStreamKey());
        ctx.endStream();

        request.setAttribute(WCMMode.REQUEST_ATTRIBUTE_NAME, WCMMode.PREVIEW);
        FuseContext author = new FuseContext();
        author.request = request;
        author.init();
        assertTrue(author.isEditMode());
    }

    @Test
    void pageStreamArmsOnlyForPublishGet() {
        PageStream ps = new PageStream();
        ps.request = request;
        ps.init();
        assertTrue(ps.isArmed());
        assertTrue(StreamContext.get(request).isArmed());

        SlingHttpServletRequest off = TestRequests.request(PATH, TYPE);
        when(off.getParameter(PageStream.PARAM)).thenReturn("off");
        PageStream psOff = new PageStream();
        psOff.request = off;
        psOff.init();
        assertFalse(psOff.isArmed());
        assertNull(StreamContext.peek(off));

        SlingHttpServletRequest post = TestRequests.request(PATH, TYPE);
        when(post.getMethod()).thenReturn("POST");
        PageStream psPost = new PageStream();
        psPost.request = post;
        psPost.init();
        assertFalse(psPost.isArmed());

        SlingHttpServletRequest edit = TestRequests.request(PATH, TYPE);
        edit.setAttribute(WCMMode.REQUEST_ATTRIBUTE_NAME, WCMMode.EDIT);
        PageStream psEdit = new PageStream();
        psEdit.request = edit;
        psEdit.init();
        assertFalse(psEdit.isArmed());
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
