#!/usr/bin/env node
/**
 * One-shot esbuild pass for the main process, the preload bridge and the headless
 * CLI. The renderer is built separately by Vite (`npm run build:renderer`).
 */
import process from 'node:process';
import { buildOnce, ENTRIES } from './esbuild.config.mjs';

const mode = process.argv.includes('--dev') ? 'development' : 'production';

try {
  const ms = await buildOnce(mode);
  const list = ENTRIES.map((e) => e.out).join(', ');
  console.log(`[build:main] ${mode} bundles ready in ${ms}ms → ${list}`);
} catch (error) {
  console.error('[build:main] failed');
  console.error(error);
  process.exit(1);
}
