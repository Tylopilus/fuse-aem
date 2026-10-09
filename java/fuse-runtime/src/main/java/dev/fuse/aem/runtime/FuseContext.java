package dev.fuse.aem.runtime;

import javax.annotation.PostConstruct;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.Self;

import com.day.cq.wcm.api.WCMMode;

/**
 * Use-object at the top of every generated component script
 * ({@code data-sly-use.fz="dev.fuse.aem.runtime.FuseContext"}).
 */
@Model(adaptables = SlingHttpServletRequest.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FuseContext {

    @Self
    SlingHttpServletRequest request;

    private String streamKey;
    private boolean editMode;

    @PostConstruct
    void init() {
        if (request == null) {
            return;
        }
        editMode = WCMMode.fromRequest(request) != WCMMode.DISABLED;
        StreamContext ctx = StreamContext.peek(request);
        Resource resource = request.getResource();
        if (ctx != null && resource != null) {
            streamKey = ctx.getStreamKey(resource.getPath());
        }
    }

    /**
     * @return the Await key being stream-rendered for <em>this</em> resource in the current include,
     *         otherwise {@code null} (normal render)
     */
    public String getStreamKey() {
        return streamKey;
    }

    /**
     * @return {@code true} unless the WCM mode is {@code DISABLED} (i.e. author edit/preview/...)
     */
    public boolean isEditMode() {
        return editMode;
    }
}
