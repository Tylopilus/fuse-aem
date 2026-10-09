#!/usr/bin/env node
import { runCli } from '../dist/cli/index.js';

runCli().catch((err) => {
  console.error('[fuse] Error:', err);
  process.exit(1);
});
