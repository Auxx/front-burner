import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutsideWorkspaceError, readText, resolveInWorkspace, WORKSPACE_ROOT, workspacePath } from './workspace.mjs';

describe('workspace', () => {
  let fixture;
  let outside;

  beforeAll(() => {
    mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
    fixture = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'ai-tools-workspace-'));
    outside = mkdtempSync(join(tmpdir(), 'ai-tools-outside-'));
    symlinkSync(outside, join(fixture, 'link-out'));
    symlinkSync(join(WORKSPACE_ROOT, 'docs'), join(fixture, 'link-in'));
  });

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('finds the workspace root', () => {
    expect(resolveInWorkspace('nx.json')).toBe(join(WORKSPACE_ROOT, 'nx.json'));
  });

  it('resolves relative paths from the workspace root', () => {
    expect(resolveInWorkspace('docs/../libs/ui')).toBe(join(WORKSPACE_ROOT, 'libs/ui'));
    expect(resolveInWorkspace('.')).toBe(WORKSPACE_ROOT);
  });

  it('accepts paths that do not exist yet', () => {
    expect(resolveInWorkspace('tmp/new/folder')).toBe(join(WORKSPACE_ROOT, 'tmp/new/folder'));
  });

  it.each([ '..', '../outside', 'docs/../../outside', '/etc/passwd', tmpdir(), 'docs\0', '' ])(
    'refuses %j',
    path => {
      expect(() => resolveInWorkspace(path)).toThrow(OutsideWorkspaceError);
    }
  );

  it('refuses a sibling folder whose name starts like the workspace', () => {
    expect(() => resolveInWorkspace(`${WORKSPACE_ROOT}-other/file`)).toThrow(OutsideWorkspaceError);
  });

  it('refuses symbolic links that lead out of the workspace, also to paths below them', () => {
    expect(() => resolveInWorkspace(join(fixture, 'link-out'))).toThrow(OutsideWorkspaceError);
    expect(() => resolveInWorkspace(join(fixture, 'link-out', 'new-file.png'))).toThrow(OutsideWorkspaceError);
  });

  it('accepts symbolic links that stay inside', () => {
    expect(resolveInWorkspace(join(fixture, 'link-in', 'README.md'))).toBe(join(fixture, 'link-in', 'README.md'));
  });

  it('keeps paths inside a narrower root, resolved from a base', () => {
    const options = { base: fixture, root: fixture };
    expect(resolveInWorkspace('index.html', options)).toBe(join(fixture, 'index.html'));
    expect(() => resolveInWorkspace('../nx.json', options)).toThrow(OutsideWorkspaceError);
  });

  it('formats workspace paths for messages', () => {
    expect(workspacePath(join(WORKSPACE_ROOT, 'libs', 'ui'))).toBe('libs/ui');
  });

  it('reads text with LF line breaks, also from a Windows checkout', () => {
    writeFileSync(join(fixture, 'crlf.md'), '# One\r\n\r\nTwo\r\n');
    writeFileSync(join(fixture, 'lf.md'), '# One\n\nTwo\n');
    expect(readText(join(fixture, 'crlf.md'))).toBe('# One\n\nTwo\n');
    expect(readText(join(fixture, 'lf.md'))).toBe('# One\n\nTwo\n');
  });
});
