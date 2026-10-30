import { GitEngine, GitOptions, GitRunner } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { IMAGE_SIZE_LIMIT } from '@front-burner/shared-contracts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toFilesError } from '../files/files-errors';
import { IMAGE_TYPES, ImageFiles } from './image-files';

const gitEnv = {
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null'
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe' });

const options: GitOptions = {
  helpersDir: '/nonexistent',
  egress: { blockPrivateNetworks: true },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000,
  knownHosts: []
};

// As the controller answers them.
const refusal = (promise: Promise<unknown>): Promise<unknown> =>
  promise.catch(toFilesError).then(
    () => 'succeeded',
    (error: unknown) =>
      error instanceof ApiErrorException
        ? { status: error.getStatus(), code: error.code, params: error.params }
        : error
  );

describe('ImageFiles', () => {
  let dir: string;
  let root: string;
  let images: ImageFiles;

  const open = async (path: string) => {
    const image = await images.open(root, path);
    await image.handle.close();
    return { type: image.type, size: image.size, etag: image.etag };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-images-spec-'));
    root = join(dir, 'copy');
    mkdirSync(join(root, 'img'), { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    images = new ImageFiles(new GitEngine(options, new GitRunner()));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes the content type from the extension, ignoring case', async () => {
    for (const [ extension, type ] of Object.entries(IMAGE_TYPES)) {
      writeFileSync(join(root, 'img', `a${extension.toUpperCase()}`), '<html>not an image</html>');

      expect(await open(`img/a${extension.toUpperCase()}`)).toMatchObject({ type, size: 25 });
    }
    expect(IMAGE_TYPES['.jpeg']).toBe('image/jpeg');
    expect(IMAGE_TYPES['.jxl']).toBe('image/jxl');
  });

  it('AC-EDIT-003.7: refuses a missing image, a 12 MB PNG and a .tiff with their codes', async () => {
    writeFileSync(join(root, 'big.png'), '');
    truncateSync(join(root, 'big.png'), 12 * 1024 * 1024);
    writeFileSync(join(root, 'photo.tiff'), 'x');
    writeFileSync(join(root, 'limit.png'), '');
    truncateSync(join(root, 'limit.png'), IMAGE_SIZE_LIMIT);

    expect(await refusal(images.open(root, 'missing.png')))
      .toEqual({ status: 404, code: 'entry-not-found', params: {} });
    expect(await refusal(images.open(root, 'big.png')))
      .toEqual({ status: 413, code: 'image-too-large', params: { limit: IMAGE_SIZE_LIMIT } });
    expect(await refusal(images.open(root, 'photo.tiff')))
      .toEqual({ status: 415, code: 'image-format-unsupported', params: {} });
    expect(await open('limit.png')).toMatchObject({ size: IMAGE_SIZE_LIMIT });
  });

  it('answers a folder named like an image as missing', async () => {
    mkdirSync(join(root, 'folder.png'));

    expect(await refusal(images.open(root, 'folder.png')))
      .toEqual({ status: 404, code: 'entry-not-found', params: {} });
  });

  it('refuses an image through a symbolic link', async () => {
    writeFileSync(join(dir, 'outside.png'), 'secret');
    symlinkSync('/etc/passwd', join(root, 'logo.png'));
    symlinkSync(join(dir, 'outside.png'), join(root, 'img', 'outside.png'));
    symlinkSync(join(root, 'img'), join(root, 'linked'));
    writeFileSync(join(root, 'img', 'a.png'), 'png');
    const symlink = { status: 400, code: 'path-refused', params: { reason: 'symlink' } };

    expect(await refusal(images.open(root, 'logo.png'))).toEqual(symlink);
    symlinkSync('/etc/passwd', join(root, 'passwd'));
    expect(await refusal(images.open(root, 'passwd'))).toEqual(symlink);
    expect(await refusal(images.open(root, 'img/outside.png'))).toEqual(symlink);
    expect(await refusal(images.open(root, 'linked/a.png'))).toEqual(symlink);
  });

  it('AC-EDIT-003.6: refuses ../ paths and .git paths', async () => {
    writeFileSync(join(dir, 'outside.png'), 'secret');
    writeFileSync(join(root, '.git', 'x.png'), 'x');

    expect(await refusal(images.open(root, '../outside.png')))
      .toMatchObject({ status: 400, code: 'path-refused' });
    expect(await refusal(images.open(root, 'img/../../outside.png')))
      .toMatchObject({ status: 400, code: 'path-refused' });
    expect(await refusal(images.open(root, '.git/x.png')))
      .toMatchObject({ status: 400, code: 'path-refused' });
    expect(await refusal(images.open(root, '/etc/x.png')))
      .toMatchObject({ status: 400, code: 'path-refused' });
    // Refused for the path, not for the format.
    expect(await refusal(images.open(root, '../../../../etc/passwd')))
      .toMatchObject({ status: 400, code: 'path-refused' });
    expect(await refusal(images.open(root, '.git/config')))
      .toMatchObject({ status: 400, code: 'path-refused' });
  });
});
