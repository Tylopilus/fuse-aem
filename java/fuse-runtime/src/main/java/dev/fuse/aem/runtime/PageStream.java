package dev.fuse.aem.runtime;

import javax.annotation.PostConstruct;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.InjectionStrategy;
import org.apache.sling.models.annotations.injectorspecific.OSGiService;
import org.apache.sling.models.annotations.injectorspecific.Self;

import com.day.cq.wcm.api.WCMMode;

/**
 * Arms out-of-order streaming for the current page request. Used once in the page head
 * ({@code customheaderlibs.html}): {@code <sly data-sly-use.fuseStream="dev.fuse.aem.runtime.PageStream"/>}.
 *
 * <p>Streaming is <em>not</em> armed when the WCM mode is not {@code DISABLED}, the request is not
 * a {@code GET}, or the query parameter {@code fuse-stream=off} is present.</p>
 */
@Model(adaptables = SlingHttpServletRequest.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class PageStream {

    /** Query parameter that disables streaming when set to {@link #PARAM_OFF}. */
    public static final String PARAM = "fuse-stream";
    /** Value of {@link #PARAM} that disables streaming. */
    public static final String PARAM_OFF = "off";

    @Self
    SlingHttpServletRequest request;

    @OSGiService(injectionStrategy = InjectionStrategy.OPTIONAL)
    FuseExecutor executor;

    private boolean armed;

    @PostConstruct
    void init() {
        if (request == null
                || WCMMode.fromRequest(request) != WCMMode.DISABLED
                || !"GET".equalsIgnoreCase(request.getMethod())
                || PARAM_OFF.equals(request.getParameter(PARAM))) {
            return;
        }
        StreamContext ctx = StreamContext.get(request);
        ctx.arm();
        // Fix the global deadline now so that rendering + streaming together are bounded.
        ctx.deadlineNanos(executor != null ? executor.getTimeoutMs() : FuseExecutor.DEFAULT_TIMEOUT_MS);
        armed = ctx.isArmed();
    }

    /**
     * @return {@code true} if streaming is armed for this request
     */
    public boolean isArmed() {
        return armed;
    }
}
