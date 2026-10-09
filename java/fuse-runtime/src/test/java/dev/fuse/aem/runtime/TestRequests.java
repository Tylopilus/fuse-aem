package dev.fuse.aem.runtime;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

import java.util.HashMap;
import java.util.Map;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;

/** Mockito helpers: requests with a working attribute map. */
final class TestRequests {

    private TestRequests() {
    }

    /**
     * @param resourcePath path of {@code request.getResource()}
     * @param resourceType its resource type
     * @return a mocked GET request backed by a real attribute map
     */
    static SlingHttpServletRequest request(String resourcePath, String resourceType) {
        Map<String, Object> attributes = new HashMap<>();
        SlingHttpServletRequest request = mock(SlingHttpServletRequest.class);
        lenient().when(request.getAttribute(anyString())).thenAnswer(inv -> attributes.get(inv.<String>getArgument(0)));
        lenient().doAnswer(inv -> {
            attributes.put(inv.getArgument(0), inv.getArgument(1));
            return null;
        }).when(request).setAttribute(anyString(), org.mockito.ArgumentMatchers.any());
        lenient().doAnswer(inv -> attributes.remove(inv.<String>getArgument(0)))
                .when(request).removeAttribute(anyString());
        lenient().when(request.getMethod()).thenReturn("GET");

        Resource resource = mock(Resource.class);
        lenient().when(resource.getPath()).thenReturn(resourcePath);
        lenient().when(resource.getResourceType()).thenReturn(resourceType);
        lenient().when(request.getResource()).thenReturn(resource);

        ResourceResolver resolver = mock(ResourceResolver.class);
        lenient().when(request.getResourceResolver()).thenReturn(resolver);
        lenient().when(resource.getResourceResolver()).thenReturn(resolver);
        return request;
    }

    /**
     * Returns a request sharing the attributes of {@code base} but pointing at another resource
     * (like an include wrapper).
     */
    static SlingHttpServletRequest include(SlingHttpServletRequest base, String resourcePath, String resourceType) {
        SlingHttpServletRequest request = request(resourcePath, resourceType);
        lenient().when(request.getAttribute(anyString())).thenAnswer(inv -> base.getAttribute(inv.getArgument(0)));
        lenient().doAnswer(inv -> {
            base.setAttribute(inv.getArgument(0), inv.getArgument(1));
            return null;
        }).when(request).setAttribute(anyString(), org.mockito.ArgumentMatchers.any());
        return request;
    }
}
