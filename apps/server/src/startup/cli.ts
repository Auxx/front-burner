const OPENAPI_FLAG = '--write-openapi';

/**
 * The file named by `--write-openapi <file>`, or `undefined` without the flag.
 *
 * @throws Error when the flag has no file after it.
 */
export function parseOpenApiFile(argv: string[]): string | undefined {
  const flag = argv.indexOf(OPENAPI_FLAG);
  if (flag < 0) {
    return undefined;
  }
  const file = argv[flag + 1];
  if (file === undefined || file.startsWith('--')) {
    throw new Error(`${OPENAPI_FLAG} needs a file to write the document to`);
  }
  return file;
}
