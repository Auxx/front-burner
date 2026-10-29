import { signal } from '@angular/core';
import type { FileContent } from '@front-burner/shared-contracts';
import { FileSaver, type SaveResult } from '@front-burner/web-core';

import type { OpenFile } from '../repository-screen/services/open-files/open-files.service';

/** The content of a file as `readFile` answers it. */
export function fileContent(path: string, overrides: Partial<FileContent> = {}): FileContent {
  return {
    path,
    content: `# ${path}\n`,
    lineEnding: 'lf',
    bom: false,
    hash: 'a'.repeat(64),
    size: 100,
    ...overrides
  };
}

/** An open file whose saves go to `send`, which by default never answers. */
export function openFile(
  path: string,
  overrides: Partial<FileContent> = {},
  send: (content: string) => Promise<SaveResult> = () => new Promise(() => undefined)
): OpenFile {
  const file = fileContent(path, overrides);
  return {
    path: signal(path),
    file,
    revision: signal(0),
    hash: signal(file.hash),
    editorState: null,
    saver: new FileSaver({ lastSaved: file.content, send }),
    highlight: signal(true),
    largeOnNarrow: false,
    size: file.size,
    draft: signal(null),
    changed: signal(null),
    gone: signal(false),
    recreateError: signal(null)
  };
}
