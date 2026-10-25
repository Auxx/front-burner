// Enforces NF-2.9: the initial JavaScript of the web client stays within 300 KB
// gzipped. The initial files are the scripts that index.html loads plus their
// modulepreloads; lazy chunks are not counted. Prints every file's size and
// fails above the limit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_BYTES = 300 * 1024;

/** The JavaScript files that index.html loads on start, in document order. */
export function initialScripts(html) {
  const files = [];
  for (const [ tag ] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const isScript = tag.startsWith('<script');
    const isPreload = /\brel=["']modulepreload["']/.test(tag);
    if (!isScript && !isPreload) {
      continue;
    }
    const url = tag.match(/\b(?:src|href)=["']([^"']+)["']/)?.[1];
    if (url && /\.js$/.test(url) && !/^(?:[a-z]+:)?\/\//.test(url) && !files.includes(url)) {
      files.push(url);
    }
  }
  return files;
}

export function measure(dir, limit = LIMIT_BYTES) {
  const files = initialScripts(readFileSync(join(dir, 'index.html'), 'utf8'));
  if (files.length === 0) {
    throw new Error(`${dir}/index.html loads no scripts`);
  }
  const sizes = files.map(file => ({ file, bytes: gzipSync(readFileSync(join(dir, file))).length }));
  const total = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
  return { sizes, total, limit, ok: total <= limit };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'dist/apps/web/browser';
  const limit = process.argv[3] ? Number(process.argv[3]) : LIMIT_BYTES;
  const { sizes, total, ok } = measure(dir, limit);
  for (const { file, bytes } of sizes) {
    console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB gzip  ${file}`);
  }
  console.log(
    `${(total / 1024).toFixed(1).padStart(8)} KB gzip  initial total (limit ${(limit / 1024).toFixed(0)} KB)`
  );
  if (!ok) {
    console.error(
      `Initial JavaScript is ${(total / 1024).toFixed(1)} KB gzipped, over the ${
        (limit / 1024).toFixed(0)
      } KB limit (NF-2.9).`
    );
    process.exit(1);
  }
}
