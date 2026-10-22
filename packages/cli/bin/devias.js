#!/usr/bin/env node
// Runs the TypeScript CLI source through tsx so the package needs no build step.
import { tsImport } from 'tsx/esm/api';

const { run } = await tsImport('../src/main.ts', import.meta.url);
await run(process.argv);
