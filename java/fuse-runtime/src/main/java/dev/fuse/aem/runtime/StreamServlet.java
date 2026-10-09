package dev.fuse.aem.runtime;

import java.io.IOException;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import javax.servlet.RequestDispatcher;
import javax.servlet.Servlet;
import javax.servlet.ServletException;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.request.RequestDispatcherOptions;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.SyntheticResource;
import org.apache.sling.api.servlets.SlingSafeMethodsServlet;
import org.apache.sling.servlets.annotations.SlingServletResourceTypes;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.day.cq.wcm.api.components.IncludeOptions;

/**
 * Streams resolved {@code <Await>} blocks at the end of the page body.
 *
 * <p>Included once per page from {@code customfooterlibs.html}:</p>
 * <pre>{@code <sly data-sly-resource="${'fuse-stream' @ resourceType='fuse/components/stream'}"/>}</pre>
 *
 * <p>For every entry registered in the {@link StreamContext} the servlet waits (in completion
 * order, bounded by the global deadline of {@link FuseExecutor#getTimeoutMs()}) for its future,
 * re-renders the original component resource with the stream target set (forced resource type,
 * no WCM decoration) and writes {@code <template data-fuse-r="<id>">html</template>}, flushing
 * after each chunk. Failed, timed-out or un-renderable entries produce
 * {@code <template data-fuse-r="<id>" data-fuse-error></template>}; the placeholder keeps its
 * fallback.</p>
 */
@Component(service = Servlet.class)
@SlingServletResourceTypes(resourceTypes = StreamServlet.RESOURCE_TYPE, methods = "GET", extensions = "html")
public class StreamServlet extends SlingSafeMethodsServlet {

    private static final long serialVersionUID = 1L;
    private static final Logger LOG = LoggerFactory.getLogger(StreamServlet.class);

    /** Resource type the servlet is registered for. */
    public static final String RESOURCE_TYPE = "fuse/components/stream";

    @Reference
    private transient FuseExecutor executor;

    @Override
    protected void doGet(SlingHttpServletRequest request, SlingHttpServletResponse response)
            throws ServletException, IOException {
        StreamContext ctx = StreamContext.peek(request);
        if (ctx == null) {
            return;
        }
        if (!ctx.hasPending()) {
            ctx.close();
            return;
        }
        long timeoutMs = executor != null ? executor.getTimeoutMs() : FuseExecutor.DEFAULT_TIMEOUT_MS;
        long deadline = ctx.deadlineNanos(timeoutMs);
        PrintWriter out = response.getWriter();
        Sink sink = new Sink() {
            @Override
            public void write(String s) throws IOException {
                out.write(s);
                if (out.checkError()) {
                    throw new IOException("Client connection closed");
                }
            }

            @Override
            public void flush() throws IOException {
                out.flush();
                if (out.checkError()) {
                    throw new IOException("Client connection closed");
                }
                response.flushBuffer();
            }
        };
        stream(ctx, deadline, sink, (entry, value) -> renderEntry(request, response, ctx, entry, value));
    }

    /**
     * Re-renders the component of {@code entry} into a buffer with the stream target set.
     */
    private static String renderEntry(SlingHttpServletRequest request, SlingHttpServletResponse response,
            StreamContext ctx, StreamContext.Entry entry, Object value) throws Exception {
        ResourceResolver resolver = request.getResourceResolver();
        Resource resource = resolver.getResource(entry.getResourcePath());
        if (resource == null) {
            resource = new SyntheticResource(resolver, entry.getResourcePath(), entry.getResourceType());
        }
        RequestDispatcherOptions options = new RequestDispatcherOptions();
        if (entry.getResourceType() != null) {
            options.setForceResourceType(entry.getResourceType());
        }
        RequestDispatcher dispatcher = request.getRequestDispatcher(resource, options);
        if (dispatcher == null) {
            throw new ServletException("No request dispatcher for " + entry);
        }
        BufferedResponse buffer = new BufferedResponse(response);
        ctx.beginStream(entry, value);
        try {
            // Suppress the WCM decoration element (applies to the next include only).
            IncludeOptions.getOptions(request, true).setDecorationTagName("");
            dispatcher.include(request, buffer);
        } finally {
            ctx.endStream();
        }
        return buffer.getContent();
    }

    // ------------------------------------------------------------------------------------------
    // Streaming loop (package-private for tests)
    // ------------------------------------------------------------------------------------------

    /** Output abstraction of the streaming loop. */
    interface Sink {
        /** Writes markup; throws if the client is gone. */
        void write(String s) throws IOException;

        /** Flushes the writer and the response buffer; throws if the client is gone. */
        void flush() throws IOException;
    }

    /** Renders a resolved entry to HTML. */
    interface Renderer {
        /** @return the HTML of the resolved block */
        String render(StreamContext.Entry entry, Object value) throws Exception;
    }

    /**
     * Streams all pending entries of {@code ctx} (including entries registered while rendering
     * other entries, e.g. nested {@code <Await>}s) until none are left or the deadline passes.
     * Always closes the context, cancels left-over futures and emits error templates for them.
     *
     * @param ctx           the request's stream context
     * @param deadlineNanos global deadline ({@link System#nanoTime()} units)
     * @param sink          output
     * @param renderer      renders resolved entries
     */
    static void stream(StreamContext ctx, long deadlineNanos, Sink sink, Renderer renderer) {
        List<StreamContext.Entry> waiting = new ArrayList<>(ctx.drainPending());
        boolean clientGone = false;
        try {
            sink.flush();
            while (true) {
                waiting.addAll(ctx.drainPending());
                if (waiting.isEmpty()) {
                    break;
                }
                StreamContext.Entry next = removeFirstDone(waiting);
                if (next != null) {
                    emit(ctx, next, sink, renderer);
                    continue;
                }
                long remaining = deadlineNanos - System.nanoTime();
                if (remaining <= 0) {
                    break;
                }
                CompletableFuture<?>[] futures = new CompletableFuture<?>[waiting.size()];
                for (int i = 0; i < futures.length; i++) {
                    futures[i] = waiting.get(i).getFuture();
                }
                try {
                    CompletableFuture.anyOf(futures).get(remaining, TimeUnit.NANOSECONDS);
                } catch (TimeoutException e) {
                    break;
                } catch (ExecutionException | CancellationException e) {
                    // one of the futures failed; it is "done" and handled in the next iteration
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } catch (IOException e) {
            clientGone = true;
            LOG.debug("Client went away while streaming Fuse blocks", e);
        } finally {
            ctx.close();
            waiting.addAll(ctx.drainPending());
            for (StreamContext.Entry entry : waiting) {
                entry.getFuture().cancel(true);
                LOG.warn("Fuse block {} not resolved before the deadline", entry);
            }
            if (!clientGone && !waiting.isEmpty()) {
                try {
                    for (StreamContext.Entry entry : waiting) {
                        sink.write(errorTemplate(entry.getId()));
                    }
                    sink.flush();
                } catch (IOException e) {
                    LOG.debug("Client went away while streaming Fuse blocks", e);
                }
            }
        }
    }

    private static void emit(StreamContext ctx, StreamContext.Entry entry, Sink sink, Renderer renderer) throws IOException {
        Object value;
        try {
            value = entry.getFuture().join();
        } catch (CompletionException | CancellationException e) {
            LOG.warn("Fuse block {} failed", entry, e.getCause() != null ? e.getCause() : e);
            sink.write(errorTemplate(entry.getId()));
            sink.flush();
            return;
        }
        String html;
        ctx.beginStream(entry, value);
        try {
            html = renderer.render(entry, value);
        } catch (Exception e) { // NOSONAR - any rendering error must only affect this block
            LOG.warn("Rendering Fuse block {} failed", entry, e);
            sink.write(errorTemplate(entry.getId()));
            sink.flush();
            return;
        } finally {
            ctx.endStream();
        }
        sink.write("<template data-fuse-r=\"" + escapeAttr(entry.getId()) + "\">"
                + (html != null ? html : "") + "</template>" + readyMarker(entry.getId()));
        sink.flush();
    }

    private static StreamContext.Entry removeFirstDone(List<StreamContext.Entry> entries) {
        for (Iterator<StreamContext.Entry> it = entries.iterator(); it.hasNext();) {
            StreamContext.Entry entry = it.next();
            if (entry.getFuture().isDone()) {
                it.remove();
                return entry;
            }
        }
        return null;
    }

    static String errorTemplate(String id) {
        return "<template data-fuse-r=\"" + escapeAttr(id) + "\" data-fuse-error></template>" + readyMarker(id);
    }

    private static String readyMarker(String id) {
        return "<template data-fuse-ready=\"" + escapeAttr(id) + "\"></template>";
    }

    private static String escapeAttr(String s) {
        return s.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;");
    }
}
