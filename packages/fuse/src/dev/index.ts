import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import * as esbuild from 'esbuild';
import vm from 'node:vm';
// @ts-ignore
import Compiler from '@adobe/htlengine/src/compiler/Compiler.js';
// @ts-ignore
import Runtime from '@adobe/htlengine/src/runtime/Runtime.js';
import { FuseConfig, discoverComponents, build } from '../compiler/index.js';
import { ComponentEntry } from '../compiler/template.js';

export interface DevServerOptions {
  config: FuseConfig;
  port?: number;
  mockPage?: Record<string, any>;
}

export interface StreamItem {
  id: string;
  key: string;
  resourcePath: string;
  resourceType: string;
  promise: Promise<any>;
}

export class DevRenderer {
  private compiler = new Compiler();
  private compiledFns = new Map<string, Function>();

  constructor(private config: FuseConfig, private registry: Map<string, ComponentEntry>) {
    this.compiler
      .withScriptResolver(async (baseDir: string, filename: string) => {
        if (filename.includes('templates.html')) {
          return '/virtual/core/wcm/components/commons/v1/templates.html';
        }
        return path.resolve(baseDir, filename);
      })
      .withTemplateLoader(async (templatePath: string) => {
        if (templatePath.includes('templates.html')) {
          return {
            data: '<template data-sly-template.placeholder="${@ isEmpty, classAppend}"></template>',
          };
        }
        return {
          data: fs.readFileSync(templatePath, 'utf8'),
        };
      });
  }

  updateRegistry(newRegistry: Map<string, ComponentEntry>) {
    this.registry = newRegistry;
    this.compiledFns.clear();
  }

  async getTemplateFn(componentName: string, htlSource?: string): Promise<Function> {
    let fn = this.compiledFns.get(componentName);
    if (fn && !htlSource) return fn;

    let source = htlSource;
    if (!source) {
      const htlPath = path.join(this.config.appsDir, componentName, `${componentName}.html`);
      if (!fs.existsSync(htlPath)) {
        throw new Error(`HTL file not found for ${componentName} at ${htlPath}`);
      }
      source = fs.readFileSync(htlPath, 'utf8');
    }

    // Compile HTL to function with custom module resolver for data-sly-use
    fn = await this.compiler.compileToFunction(source, this.config.appsDir, (id: string) => {
      return this.resolveUseModule(id, componentName);
    });

    if (!fn) throw new Error(`Failed to compile template function for ${componentName}`);
    this.compiledFns.set(componentName, fn);
    return fn;
  }

  private resolveUseModule(id: string, currentComponent: string): any {
    // FuseContext
    if (id === 'dev.fuse.aem.runtime.FuseContext') {
      return class {
        async use(globals: any) {
          const streamTarget = globals.request?.streamTarget;
          const key = streamTarget?.key ?? null;
          const editMode = globals.request?.isEditMode ?? false;
          return {
            streamKey: key,
            isEditMode: editMode,
            getStreamKey: () => key,
            isEdit: () => editMode,
          };
        }
      };
    }

    // Await
    if (id === 'dev.fuse.aem.runtime.Await') {
      return class {
        key = '';
        value: any = null;
        async use(globals: any) {
          const req = globals.request;
          const streamTarget = req?.streamTarget;
          const isStreamRender = streamTarget && streamTarget.key === this.key;

          if (isStreamRender) {
            return {
              pending: false,
              id: streamTarget.id,
              value: streamTarget.value,
              isPending: () => false,
              getId: () => streamTarget.id,
              getValue: () => streamTarget.value,
            };
          }

          const isPromise = this.value && typeof this.value.then === 'function';
          if (!isPromise) {
            return {
              pending: false,
              id: 'static',
              value: this.value,
              isPending: () => false,
              getId: () => 'static',
              getValue: () => this.value,
            };
          }

          // Register pending stream item
          const id = req ? `fz-${++req.streamCounter}` : `fz-${Math.random()}`;
          if (req?.streamItems) {
            req.streamItems.push({
              id,
              key: this.key,
              resourcePath: req.currentResourcePath,
              resourceType: req.currentResourceType,
              promise: this.value,
            });
          }

          return {
            pending: true,
            id,
            value: null,
            isPending: () => true,
            getId: () => id,
            getValue: () => null,
          };
        }
      };
    }

    // Core templates placeholder
    if (id.includes('templates.html')) {
      return class {
        async use() {
          return {
            placeholder: () => '',
          };
        }
      };
    }

    // Component Sling Model / Props
    const comp = this.registry.get(currentComponent);
    return class {
      async use(globals: any) {
        const props = globals.properties || {};
        let mockModel: any = {};

        // Load mock file if present
        if (comp?.mockFile && fs.existsSync(comp.mockFile)) {
          mockModel = await loadMockFile(comp.mockFile, props);
        }

        // Return unified model combining dialog properties and mock model methods
        return {
          ...props,
          ...mockModel,
        };
      }
    };
  }

  async renderComponent(
    componentName: string,
    properties: Record<string, any>,
    reqContext: any,
    streamTarget?: { key: string; id: string; value: any },
  ): Promise<string> {
    const fn = await this.getTemplateFn(componentName);
    const runtime = new Runtime();

    reqContext.currentResourceType = `${this.config.resourceTypePrefix}/${componentName}`;
    reqContext.streamTarget = streamTarget;

    runtime.setGlobal({
      properties,
      request: reqContext,
      currentPage: { title: 'Fuse Dev Preview' },
    });

    // Provide resource loader for <Container> and <Include> (data-sly-resource)
    runtime.withResourceLoader(async (_rt: any, uri: string, options: any) => {
      const resourceType = options?.resourceType;
      if (!resourceType) return '';

      // Child resource properties
      const childProps = properties[uri] || (reqContext.mockPage && reqContext.mockPage[uri]) || {};
      const targetCompName = resourceType.split('/').pop()!;
      if (this.registry.has(targetCompName)) {
        const subReq = { ...reqContext, currentResourcePath: `${reqContext.currentResourcePath}/${uri}` };
        return await this.renderComponent(targetCompName, childProps, subReq);
      }
      return '';
    });

    return await fn(runtime);
  }
}

async function loadMockFile(mockFilePath: string, props: any): Promise<any> {
  const code = fs.readFileSync(mockFilePath, 'utf8');
  const bundled = await esbuild.build({
    stdin: {
      contents: code,
      resolveDir: path.dirname(mockFilePath),
      loader: 'ts',
    },
    bundle: false,
    format: 'cjs',
    target: 'node18',
    write: false,
  });

  const js = bundled.outputFiles[0].text;
  const mod: { exports: any } = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: () => ({}),
    props,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    Promise,
    console,
    process,
  };

  try {
    vm.runInNewContext(js, sandbox);
    const exp = mod.exports.default !== undefined ? mod.exports.default : mod.exports;
    return typeof exp === 'function' ? exp(props) : exp;
  } catch (err) {
    console.error(`[fuse-dev] Error running mock ${mockFilePath}:`, err);
    return {};
  }
}

/**
 * Creates and starts the local Dev Preview HTTP server.
 */
export async function startDevServer(options: DevServerOptions): Promise<http.Server> {
  const { config, port = 3000 } = options;

  // Initial build
  await build(config);
  let registry = await discoverComponents(config);
  const renderer = new DevRenderer(config, registry);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

    // Serve static clientlibs: /etc.clientlibs/...
    if (pathname.includes('/clientlibs/')) {
      const rel = pathname.slice(pathname.indexOf('/clientlibs/clientlib-fuse') + '/clientlibs/clientlib-fuse'.length);
      const filePath = path.join(config.clientLibDir, rel.replace(/^\//, ''));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const contentType = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/plain';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // Default mock page rendering
    const mockPage = options.mockPage || {
      title: 'Fuse Local Dev Preview',
      items: {
        teaser: {
          title: 'Experience Qwik-style AEM components',
          description: 'Single-file TSX components compiled ahead of time into native HTL, dialogs, and models.',
          link: '/content/acme/about.html',
          showAction: true,
        },
        counter: {
          initialCount: 5,
          step: 2,
        },
        accordion: {
          heading: 'Frequently Asked Questions',
          items: [
            { title: 'How does it work?', body: '<p>Ahead-of-time compilation to native AEM artifacts.</p>' },
            { title: 'Is there Node in production?', body: '<p>Zero Node.js in production. AEM handles all SSR.</p>' },
          ],
        },
        'stock-ticker': {
          symbol: 'ADBE',
        },
      },
    };

    // Prepare streaming context
    const streamItems: StreamItem[] = [];
    const reqContext = {
      isEditMode: url.searchParams.get('wcmmode') === 'edit',
      streamCounter: 0,
      streamItems,
      currentResourcePath: '/content/acme/page/jcr:content',
      mockPage,
    };

    // Render components
    let componentsHtml = '';
    for (const [compName, compProps] of Object.entries(mockPage.items)) {
      if (registry.has(compName)) {
        componentsHtml += `<div class="component-wrapper" style="margin-bottom: 24px;">\n`;
        componentsHtml += await renderer.renderComponent(compName, compProps as any, reqContext);
        componentsHtml += `\n</div>\n`;
      }
    }

    const clientlibUrl = config.clientLibUrl.replace(/\/resources\/chunks$/, '');

    const initialHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${mockPage.title}</title>
  <link rel="stylesheet" href="${clientlibUrl}/components.css"/>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    header { border-bottom: 1px solid #e0e0e0; padding-bottom: 16px; margin-bottom: 32px; }
    h1 { margin: 0 0 8px; }
    .badge { display: inline-block; background: #0066cc; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
    .stream-status { margin-top: 32px; font-size: 13px; color: #666; border-top: 1px dashed #ccc; padding-top: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>${mockPage.title} <span class="badge">AEM Native HTL</span></h1>
    <p>Rendered with Adobe HTL Engine + Out-of-Order Streaming Simulation</p>
  </header>
  <main>
${componentsHtml}
  </main>
  <script src="${clientlibUrl}/fuse-loader.js"></script>
`;

    // Send HTTP headers for chunked streaming
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache, no-transform',
    });

    res.write(initialHtml);

    // Stream out-of-order blocks as they complete!
    if (streamItems.length > 0) {
      const pending = [...streamItems];
      while (pending.length > 0) {
        // Wait for the next completed item
        const wrapped = pending.map((item, index) =>
          item.promise.then(
            (val) => ({ item, index, val, error: false }),
            (err) => ({ item, index, val: err, error: true }),
          ),
        );

        const result = await Promise.race(wrapped);
        pending.splice(result.index, 1);

        if (result.error) {
          res.write(`<template data-fuse-r="${result.item.id}" data-fuse-error></template>\n`);
        } else {
          const compName = result.item.resourceType.split('/').pop()!;
          const resolvedHtml = await renderer.renderComponent(
            compName,
            mockPage.items[compName] || {},
            reqContext,
            { key: result.item.key, id: result.item.id, value: result.val },
          );
          res.write(`<template data-fuse-r="${result.item.id}">${resolvedHtml}</template>\n`);
        }
      }
    }

      res.write(`</body>\n</html>\n`);
      res.end();
    } catch (err) {
      console.error('[fuse-dev] Server error handling request:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end(`Internal Server Error: ${err}`);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve(server);
    });
  });
}
