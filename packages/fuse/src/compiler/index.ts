import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import vm from 'node:vm';
import { pascal, kebab, javaSegment } from './util.js';
import { SchemaJson, ComponentEntry, CompileContext, compileTemplate, CHUNK_PLACEHOLDER } from './template.js';
import { generateComponentContentXml, generateDialogXml } from './dialog.js';
import { generateJavaProps, parseJavaModel, generateModelDts } from './java.js';
import { bundleClientChunk, bundleLoader, bundleStyles } from './bundler.js';
import { writeClientLib } from './clientlib.js';

export * from './util.js';
export * from './expr.js';
export * from './template.js';
export * from './dialog.js';
export * from './java.js';
export * from './bundler.js';
export * from './clientlib.js';

export interface FuseConfig {
  /** Directory containing component folders (e.g. src/components) */
  srcDir: string;
  /** Directory for ui.apps components (e.g. ui.apps/src/main/content/jcr_root/apps/acme/components) */
  appsDir: string;
  /** Directory for ui.apps clientlibs (e.g. ui.apps/src/main/content/jcr_root/apps/acme/clientlibs/clientlib-fuse) */
  clientLibDir: string;
  /** Web URL path to clientlib chunks (e.g. /etc.clientlibs/acme/clientlibs/clientlib-fuse/resources/chunks) */
  clientLibUrl: string;
  /** Directory for core Java files (e.g. core/src/main/java/com/acme/components) */
  coreDir: string;
  /** Base Java package (e.g. com.acme.components) */
  javaPackage: string;
  /** JCR resource type prefix (e.g. acme/components) */
  resourceTypePrefix: string;
  /** Clientlib category (e.g. acme.fuse) */
  clientlibCategory?: string;
  /** Container resource type (defaults to core/wcm/components/container/v1/container) */
  containerResourceType?: string;
}

export interface BuildSummary {
  components: Array<{
    name: string;
    hasClient: boolean;
    hasDialog: boolean;
    hasModel: boolean;
    stats: any;
  }>;
  chunksCount: number;
}

/**
 * Evaluates the exported schema from a component .tsx file.
 */
async function loadComponentSchema(filePath: string): Promise<SchemaJson | null> {
  const code = fs.readFileSync(filePath, 'utf8');
  if (!code.includes('schema') || !code.includes('dialog(')) {
    return null;
  }

  // Bundle file into CommonJS in memory to extract schema without executing component$
  const bundled = await esbuild.build({
    stdin: {
      contents: code,
      resolveDir: path.dirname(filePath),
      loader: 'tsx',
    },
    bundle: false,
    format: 'cjs',
    target: 'node18',
    write: false,
  });

  const js = bundled.outputFiles[0].text;
  const mod: { exports: any } = { exports: {} };
  const mockField = {
    text: (o: any) => ({ kind: 'text', ...o }),
    textarea: (o: any) => ({ kind: 'textarea', ...o }),
    richtext: (o: any) => ({ kind: 'richtext', ...o }),
    number: (o: any) => ({ kind: 'number', ...o }),
    checkbox: (o: any) => ({ kind: 'checkbox', ...o }),
    select: (o: any) => ({ kind: 'select', ...o }),
    path: (o: any) => ({ kind: 'path', ...o }),
    link: (o: any) => ({ kind: 'link', ...o }),
    image: (o: any) => ({ kind: 'image', ...o }),
    multifield: (o: any) => ({ kind: 'multifield', ...o }),
  };
  const mockDialog = (def: any) => def;
  const mockComponent$ = () => () => null;

  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: (id: string) => {
      if (id === '@fuse-aem/fuse' || id.includes('fuse')) {
        return {
          dialog: mockDialog,
          field: mockField,
          component$: mockComponent$,
          useSignal: () => ({ value: null }),
          useStyles$: () => {},
          useVisibleTask$: () => {},
          $: (fn: any) => fn,
          css: (strings: any) => strings[0],
          Await: () => null,
          Container: () => null,
          Include: () => null,
        };
      }
      return {};
    },
  };

  try {
    vm.runInNewContext(js, sandbox);
    const schema = mod.exports.schema;
    if (schema && typeof schema === 'object' && schema.title && schema.fields) {
      return schema as SchemaJson;
    }
  } catch (err) {
    // If runtime evaluation fails, fallback to null (or AST parser)
    console.warn(`[fuse] Warning: could not evaluate schema in ${filePath}:`, err);
  }
  return null;
}

/**
 * Discovers all components in srcDir.
 */
export async function discoverComponents(config: FuseConfig): Promise<Map<string, ComponentEntry>> {
  const registry = new Map<string, ComponentEntry>();
  if (!fs.existsSync(config.srcDir)) return registry;

  const entries = fs.readdirSync(config.srcDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const compDir = path.join(config.srcDir, ent.name);
    const compName = kebab(ent.name);
    const pascalName = pascal(ent.name);

    // Find main .tsx file
    let tsxFile = path.join(compDir, `${compName}.tsx`);
    if (!fs.existsSync(tsxFile)) {
      tsxFile = path.join(compDir, 'index.tsx');
      if (!fs.existsSync(tsxFile)) continue;
    }

    // Check co-located Java model
    const javaFileName = `${pascalName}Model.java`;
    const javaFilePath = path.join(compDir, javaFileName);
    const hasJava = fs.existsSync(javaFilePath);

    // Check co-located mock
    const mockFile = path.join(compDir, `${compName}.mock.ts`);
    const hasMock = fs.existsSync(mockFile);

    // Read schema
    const schema = await loadComponentSchema(tsxFile);
    const isPartial = schema === null;

    let modelTypes: Record<string, any> = {};
    if (hasJava) {
      const parsed = parseJavaModel(javaFilePath);
      modelTypes = parsed.modelTypes;
      // Generate .d.ts next to component
      const dts = generateModelDts(parsed);
      fs.writeFileSync(path.join(compDir, `${pascalName}Model.d.ts`), dts);
    }

    const pkg = `${config.javaPackage}.${javaSegment(compName)}`;
    const modelClass = hasJava ? `${pkg}.${pascalName}Model` : `${pkg}.${pascalName}Props`;
    const propsClass = `${pkg}.${pascalName}Props`;
    const resourceType = `${config.resourceTypePrefix}/${compName}`;
    const partialPath = `${resourceType}/${compName}.html`;

    const entry: ComponentEntry = {
      name: compName,
      pascal: pascalName,
      dir: compDir,
      file: tsxFile,
      isPartial,
      schema,
      resourceType,
      modelClass,
      propsClass,
      javaPackage: pkg,
      javaModelFile: hasJava ? javaFilePath : null,
      modelTypes,
      mockFile: hasMock ? mockFile : null,
      partialPath,
    };

    registry.set(compName, entry);
  }

  return registry;
}

/**
 * Main build command: compiles all components, generates AEM artifacts, and bundles clientlibs.
 */
export async function build(config: FuseConfig): Promise<BuildSummary> {
  const registry = await discoverComponents(config);
  const compileCtx: CompileContext = {
    registry,
    containerResourceType: config.containerResourceType ?? 'core/wcm/components/container/v1/container',
    awaitClass: 'dev.fuse.aem.runtime.Await',
    contextClass: 'dev.fuse.aem.runtime.FuseContext',
  };

  const allStyles: string[] = [];
  const clientChunks: Array<{ fileName: string; code: string }> = [];
  const summary: BuildSummary = { components: [], chunksCount: 0 };

  for (const [name, entry] of registry) {
    const compiled = compileTemplate(entry, compileCtx);
    allStyles.push(...compiled.css);

    let finalHtl = compiled.htl;

    if (compiled.hasClient && compiled.clientEntry) {
      // Bundle chunk with esbuild
      const bundle = await bundleClientChunk(name, compiled.clientEntry, entry.dir);
      clientChunks.push({ fileName: bundle.chunkFileName, code: bundle.chunkCode });
      const chunkUrl = `${config.clientLibUrl.replace(/\/$/, '')}/${bundle.chunkFileName}`;
      finalHtl = finalHtl.replace(CHUNK_PLACEHOLDER, chunkUrl);
    }

    // Write component artifacts to appsDir
    const compAppDir = path.join(config.appsDir, name);
    fs.mkdirSync(compAppDir, { recursive: true });

    // HTL script
    fs.writeFileSync(path.join(compAppDir, `${name}.html`), finalHtl);

    if (entry.schema) {
      // Component definition .content.xml
      const compXml = generateComponentContentXml(entry.schema);
      fs.writeFileSync(path.join(compAppDir, '.content.xml'), compXml);

      // Dialog _cq_dialog/.content.xml
      const dialogDir = path.join(compAppDir, '_cq_dialog');
      fs.mkdirSync(dialogDir, { recursive: true });
      const dialogXml = generateDialogXml(entry.schema);
      fs.writeFileSync(path.join(dialogDir, '.content.xml'), dialogXml);

      // Generate Java Props class
      const javaDir = path.join(config.coreDir, javaSegment(name));
      fs.mkdirSync(javaDir, { recursive: true });
      const propsJava = generateJavaProps(entry.javaPackage, name, entry.schema);
      fs.writeFileSync(path.join(javaDir, `${entry.pascal}Props.java`), propsJava);

      // Copy co-located Model if present
      if (entry.javaModelFile) {
        let modelSource = fs.readFileSync(entry.javaModelFile, 'utf8');
        // Ensure package declaration matches
        modelSource = modelSource.replace(/^package\s+[^;]+;/m, `package ${entry.javaPackage};`);
        fs.writeFileSync(path.join(javaDir, path.basename(entry.javaModelFile)), modelSource);
      }
    }

    summary.components.push({
      name,
      hasClient: compiled.hasClient,
      hasDialog: !!entry.schema,
      hasModel: !!entry.javaModelFile || !!entry.schema,
      stats: compiled.stats,
    });
  }

  // Bundle clientloader
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  let loaderSrc = path.resolve(currentDir, '../client/fuse-loader.ts');
  if (!fs.existsSync(loaderSrc)) {
    loaderSrc = path.resolve(currentDir, '../../src/client/fuse-loader.ts');
  }
  const bundledLoader = await bundleLoader(loaderSrc);
  const bundledCss = bundleStyles(allStyles);

  // Write clientlib
  writeClientLib({
    outDir: config.clientLibDir,
    category: config.clientlibCategory ?? 'fuse.components',
    css: bundledCss,
    loaderJs: bundledLoader,
    chunks: clientChunks,
  });

  summary.chunksCount = clientChunks.length;
  return summary;
}
