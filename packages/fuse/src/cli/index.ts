import path from 'node:path';
import fs from 'node:fs';
import { build, FuseConfig } from '../compiler/index.js';
import { startDevServer } from '../dev/index.js';
import { kebab, pascal } from '../compiler/util.js';

export function resolveConfig(cwd: string = process.cwd()): FuseConfig {
  const configFile = path.join(cwd, 'fuse.config.json');
  if (fs.existsSync(configFile)) {
    const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return {
      srcDir: path.resolve(cwd, raw.srcDir || 'src/components'),
      appsDir: path.resolve(cwd, raw.appsDir || 'ui.apps/src/main/content/jcr_root/apps/acme/components'),
      clientLibDir: path.resolve(cwd, raw.clientLibDir || 'ui.apps/src/main/content/jcr_root/apps/acme/clientlibs/clientlib-fuse'),
      clientLibUrl: raw.clientLibUrl || '/etc.clientlibs/acme/clientlibs/clientlib-fuse/resources/chunks',
      coreDir: path.resolve(cwd, raw.coreDir || 'core/src/main/java/com/acme/components'),
      javaPackage: raw.javaPackage || 'com.acme.components',
      resourceTypePrefix: raw.resourceTypePrefix || 'acme/components',
      clientlibCategory: raw.clientlibCategory || 'acme.fuse',
    };
  }

  // Default archetype convention
  return {
    srcDir: path.resolve(cwd, 'src/components'),
    appsDir: path.resolve(cwd, 'ui.apps/src/main/content/jcr_root/apps/acme/components'),
    clientLibDir: path.resolve(cwd, 'ui.apps/src/main/content/jcr_root/apps/acme/clientlibs/clientlib-fuse'),
    clientLibUrl: '/etc.clientlibs/acme/clientlibs/clientlib-fuse/resources/chunks',
    coreDir: path.resolve(cwd, 'core/src/main/java/com/acme/components'),
    javaPackage: 'com.acme.components',
    resourceTypePrefix: 'acme/components',
    clientlibCategory: 'acme.fuse',
  };
}

export async function runCli(args: string[] = process.argv.slice(2)) {
  const cmd = args[0] || 'help';

  switch (cmd) {
    case 'build': {
      console.log('⚡ [fuse] Building AEM components...');
      const config = resolveConfig();
      const startTime = Date.now();
      const summary = await build(config);
      const elapsed = Date.now() - startTime;
      console.log(`✅ [fuse] Built ${summary.components.length} components (${summary.chunksCount} client chunks) in ${elapsed}ms:`);
      for (const c of summary.components) {
        console.log(`   - ${c.name} [dialog: ${c.hasDialog}, model: ${c.hasModel}, client: ${c.hasClient}]`);
      }
      break;
    }

    case 'dev': {
      const config = resolveConfig();
      const port = Number(process.env.PORT || 3000);
      console.log(`⚡ [fuse] Starting local Dev Preview server on http://localhost:${port}...`);
      await startDevServer({ config, port });
      console.log(`🚀 [fuse] Dev preview ready at http://localhost:${port}`);
      break;
    }

    case 'new': {
      const name = args[1];
      if (!name) {
        console.error('Error: specify a component name, e.g. `fuse new teaser`');
        process.exit(1);
      }
      const config = resolveConfig();
      scaffoldComponent(config.srcDir, name);
      break;
    }

    case 'help':
    default: {
      console.log(`
Fuse CLI – Qwik-style Single-File Components for AEM

Commands:
  fuse build        Compile all components to AEM artifacts (HTL, dialogs, models, clientlibs)
  fuse dev          Start local dev server with Adobe HTL Engine and streaming simulation
  fuse new <name>   Scaffold a new component
`);
      break;
    }
  }
}

function scaffoldComponent(srcDir: string, name: string) {
  const compName = kebab(name);
  const pName = pascal(name);
  const dir = path.join(srcDir, compName);
  fs.mkdirSync(dir, { recursive: true });

  const tsxContent = `import { component$, dialog, field, useSignal, useStyles$ } from '@fuse-aem/fuse';

export const schema = dialog({
  title: '${pName}',
  group: 'Acme',
  fields: {
    heading: field.text({ label: 'Heading', required: true }),
    description: field.textarea({ label: 'Description' }),
  },
});

export default component$<typeof schema>(({ props }) => {
  const count = useSignal(0);

  useStyles$(\`
    .cmp-${compName} {
      padding: 1rem;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
    }
  \`);

  return (
    <div class="cmp-${compName}">
      <h2>{props.heading}</h2>
      <p>{props.description}</p>
      <button onClick$={() => count.value++}>
        Clicked {count.value} times
      </button>
    </div>
  );
});
`;

  const javaContent = `package com.acme.components.${compName};

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;

@Model(
    adaptables = {SlingHttpServletRequest.class, Resource.class},
    defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class ${pName}Model extends ${pName}Props {
    // Add custom business logic here
}
`;

  fs.writeFileSync(path.join(dir, `${compName}.tsx`), tsxContent);
  fs.writeFileSync(path.join(dir, `${pName}Model.java`), javaContent);
  console.log(`✨ Created component ${compName} in ${dir}`);
}

// If executed directly
if (process.argv[1] && process.argv[1].endsWith('fuse.js')) {
  runCli().catch((err) => {
    console.error('[fuse] Build failed:', err);
    process.exit(1);
  });
}
