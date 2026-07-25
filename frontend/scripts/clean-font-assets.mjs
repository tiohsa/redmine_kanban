import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fontsDirectory = path.resolve(scriptDirectory, '../../assets/fonts');
const fontExtensions = new Set(['.woff', '.woff2', '.eot', '.ttf', '.otf']);

for (const entry of await readdir(fontsDirectory, { withFileTypes: true })) {
  if (entry.isFile() && fontExtensions.has(path.extname(entry.name))) {
    await rm(path.join(fontsDirectory, entry.name));
  }
}
