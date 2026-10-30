import { GitEngine } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { openInWorkingCopy, PathRefusedError } from '@front-burner/server-core-storage';
import { IMAGE_SIZE_LIMIT } from '@front-burner/shared-contracts';
import { Injectable } from '@nestjs/common';
import type { FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';
import { resolveEntry } from '../paths/existing-entry';

/** The image formats the preview shows, by lower-case extension; the content type is never sniffed (IM-9). */
export const IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
});

/** An image opened to be served; the caller streams from `handle` and closes it. */
export interface OpenedImage {
  handle: FileHandle;
  type: string;
  size: number;
  /** From the size and the modification time, so that a revalidation never reads the file (A-3.14). */
  etag: string;
}

export const imageFormatUnsupported = () => new ApiErrorException(415, 'image-format-unsupported');

export const imageTooLarge = () => new ApiErrorException(413, 'image-too-large');

/**
 * The image files of a working copy, as they are on disk: uncommitted and
 * ignored ones too (IM-7). Takes no lock (A-5.3), so the file is opened
 * without following a link and served from that descriptor (A-7.6).
 */
@Injectable()
export class ImageFiles {
  constructor(private readonly git: GitEngine) {}

  /**
   * @throws PathRefusedError
   * @throws ApiErrorException
   */
  async open(root: string, path: string): Promise<OpenedImage> {
    const type = IMAGE_TYPES[extname(path).toLowerCase()];
    if (type === undefined) {
      throw imageFormatUnsupported();
    }
    const { entry, submodule } = await resolveEntry(this.git, root, path);
    if (entry.type === 'symlink') {
      throw new PathRefusedError('symlink');
    }
    if (submodule || entry.type !== 'file') {
      throw new PathRefusedError('not-found');
    }
    const { handle } = await openInWorkingCopy(root, entry);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw new PathRefusedError('not-found');
      }
      if (stat.size > IMAGE_SIZE_LIMIT) {
        throw imageTooLarge();
      }
      return { handle, type, size: stat.size, etag: `"${stat.size}-${stat.mtimeMs}"` };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
}
