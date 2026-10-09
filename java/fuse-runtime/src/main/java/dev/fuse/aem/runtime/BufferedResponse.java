package dev.fuse.aem.runtime;

import java.io.ByteArrayOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;

import javax.servlet.ServletOutputStream;
import javax.servlet.WriteListener;

import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.wrappers.SlingHttpServletResponseWrapper;

/**
 * Response wrapper that captures everything written by an include into memory, so that a failing
 * include can be replaced by an error template instead of leaving half-written markup.
 */
final class BufferedResponse extends SlingHttpServletResponseWrapper {

    private final StringWriter chars = new StringWriter();
    private final PrintWriter writer = new PrintWriter(chars);
    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private ServletOutputStream outputStream;

    BufferedResponse(SlingHttpServletResponse wrapped) {
        super(wrapped);
    }

    @Override
    public PrintWriter getWriter() {
        return writer;
    }

    @Override
    public ServletOutputStream getOutputStream() {
        if (outputStream == null) {
            outputStream = new ServletOutputStream() {
                @Override
                public void write(int b) {
                    bytes.write(b);
                }

                @Override
                public void write(byte[] b, int off, int len) {
                    bytes.write(b, off, len);
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setWriteListener(WriteListener writeListener) {
                    // blocking only
                }
            };
        }
        return outputStream;
    }

    @Override
    public void flushBuffer() {
        writer.flush();
    }

    @Override
    public void resetBuffer() {
        writer.flush();
        chars.getBuffer().setLength(0);
        bytes.reset();
    }

    @Override
    public void reset() {
        resetBuffer();
    }

    @Override
    public boolean isCommitted() {
        return false;
    }

    /**
     * @return everything written so far (bytes written to the output stream first, decoded with the
     *         response encoding or UTF-8, followed by characters written to the writer)
     */
    String getContent() {
        writer.flush();
        if (bytes.size() == 0) {
            return chars.toString();
        }
        String encoding = getCharacterEncoding();
        String decoded;
        try {
            decoded = encoding != null ? bytes.toString(encoding) : bytes.toString(StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException e) {
            decoded = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
        return decoded + chars;
    }
}
