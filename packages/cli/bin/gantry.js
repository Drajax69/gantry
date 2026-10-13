#!/usr/bin/env node
// Loader shim: registers the TypeScript ESM loader, then runs the CLI source.
import { register } from 'tsx/esm/api';

register();
await import('../src/gantry.ts');
