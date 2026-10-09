import fs from 'node:fs';
import path from 'node:path';

export interface ClientLibOptions {
  outDir: string;
  category: string;
  css: string;
  loaderJs: string;
  chunks: Array<{ fileName: string; code: string }>;
}

export function writeClientLib(opts: ClientLibOptions): void {
  fs.mkdirSync(opts.outDir, { recursive: true });
  const chunksDir = path.join(opts.outDir, 'resources', 'chunks');
  fs.mkdirSync(chunksDir, { recursive: true });

  // .content.xml
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:ClientLibraryFolder"
    categories="[${opts.category}]"
    allowProxy="{Boolean}true"/>
`;
  fs.writeFileSync(path.join(opts.outDir, '.content.xml'), contentXml);

  // css.txt
  fs.writeFileSync(path.join(opts.outDir, 'css.txt'), '#base=.\ncomponents.css\n');
  fs.writeFileSync(path.join(opts.outDir, 'components.css'), opts.css);

  // js.txt
  fs.writeFileSync(path.join(opts.outDir, 'js.txt'), '#base=.\nfuse-loader.js\n');
  fs.writeFileSync(path.join(opts.outDir, 'fuse-loader.js'), opts.loaderJs);

  // Write chunks
  for (const chunk of opts.chunks) {
    fs.writeFileSync(path.join(chunksDir, chunk.fileName), chunk.code);
  }
}
