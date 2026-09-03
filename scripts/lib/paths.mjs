import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(currentDir, '../..');
export const dataDir = resolve(repoRoot, 'data');
export const reportsDir = resolve(dataDir, 'reports');
export const enrichmentsDir = resolve(dataDir, 'enrichments');
export const configDir = resolve(dataDir, 'config');
export const docsDir = resolve(repoRoot, 'docs');
export const templatesDir = resolve(repoRoot, 'templates');
