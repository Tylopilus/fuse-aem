package dev.fuse.aem.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.ResourceResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class FuseModelTest {

    /** Minimal concrete model (generated Props classes look like this). */
    static class TestModel extends FuseModel {
        CompletableFuture<String> load(String key, AtomicInteger calls) {
            return async(key, () -> {
                calls.incrementAndGet();
                return "v-" + key;
            });
        }
    }

    private SlingHttpServletRequest request;
    private ResourceResolver resolver;
    private TestModel model;

    @BeforeEach
    void setUp() {
        request = TestRequests.request("/content/site/en/jcr:content/root/teaser", "acme/components/teaser");
        resolver = request.getResourceResolver();
        when(resolver.map(any(SlingHttpServletRequest.class), anyString()))
                .thenAnswer(inv -> inv.<String>getArgument(1).replaceFirst("^/content/site", ""));
        model = new TestModel();
        model.request = request;
        model.resource = request.getResource();
    }

    @Test
    void linkMapsContentPagesAndAppendsHtml() {
        assertEquals("/en/about.html", model.link("/content/site/en/about"));
        verify(resolver).map(request, "/content/site/en/about.html");
    }

    @Test
    void linkKeepsQueryAndFragment() {
        assertEquals("/en/about.html?x=1#top", model.link("/content/site/en/about?x=1#top"));
        assertEquals("/en/about.html#top", model.link("/content/site/en/about#top"));
    }

    @Test
    void linkLeavesEverythingElseUnchanged() {
        assertNull(model.link(null));
        assertEquals("https://example.com/x", model.link("https://example.com/x"));
        assertEquals("/content/site/en/about.html", model.link("/content/site/en/about.html"));
        assertEquals("/content/dam/site/image.png", model.link("/content/dam/site/image.png"));
        assertEquals("#anchor", model.link("#anchor"));
        assertEquals("/etc/foo", model.link("/etc/foo"));
        assertEquals("mailto:a@b.c", model.link("mailto:a@b.c"));
        assertEquals("", model.link(""));
        assertEquals("/content/site/", model.link("/content/site/"));
        verify(resolver, never()).map(any(SlingHttpServletRequest.class), anyString());
    }

    @Test
    void linkFallsBackToUnmappedPathWithoutResolver() {
        TestModel bare = new TestModel();
        assertEquals("/content/site/en.html", bare.link("/content/site/en"));
    }

    @Test
    void asyncIsMemoisedPerRequestResourceAndKey() {
        AtomicInteger calls = new AtomicInteger();
        CompletableFuture<String> a = model.load("quotes", calls);
        // a second model instance for the same resource (e.g. stream re-render) gets the same future
        TestModel again = new TestModel();
        again.request = TestRequests.include(request, "/content/site/en/jcr:content/root/teaser", "acme/components/teaser");
        again.resource = again.request.getResource();
        CompletableFuture<String> b = again.load("quotes", calls);
        assertSame(a, b);
        assertEquals("v-quotes", b.join());
        assertEquals(1, calls.get());

        // other key or other resource -> other future
        assertNotSame(a, model.load("other", calls));
        TestModel otherResource = new TestModel();
        otherResource.request = TestRequests.include(request, "/content/site/en/jcr:content/root/teaser2", "acme/components/teaser");
        otherResource.resource = otherResource.request.getResource();
        assertNotSame(a, otherResource.load("quotes", calls));
    }

    @Test
    void asyncWithoutExecutorRunsInline() {
        assertNull(model.executor());
        CompletableFuture<String> f = model.load("k", new AtomicInteger());
        assertTrue(f.isDone());
        assertEquals("v-k", f.join());
    }
}
