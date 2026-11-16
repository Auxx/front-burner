import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogService, ToastService } from '@front-burner/ui';
import { RemovedRepositoriesService, type RemovedRepositoryViewer } from '@front-burner/web-core';

import { translocoTesting } from '../../../testing/transloco-testing';
import { RemovedElsewhereService, type RepositoryOnScreen } from './removed-elsewhere.service';

describe('RemovedElsewhereService', () => {
  let viewer: RemovedRepositoryViewer | undefined;
  let show: ReturnType<typeof vi.fn>;
  let closeAll: ReturnType<typeof vi.fn>;
  let page: RepositoryOnScreen;

  @Component({ selector: 'shell-repository-page', template: '' })
  class RepositoryPageComponent {
    constructor() {
      inject(RemovedElsewhereService).watch(page);
    }
  }

  function showPage(shown: RepositoryOnScreen): void {
    page = shown;
    TestBed.createComponent(RepositoryPageComponent);
  }

  beforeEach(() => {
    viewer = undefined;
    show = vi.fn();
    closeAll = vi.fn();
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          'web-shell.RemovedElsewhereService.removed': 'Repository {{ name }} removed.',
          'web-shell.RemovedElsewhereService.removedUnsaved':
            'Repository {{ name }} removed. Your unsaved changes to its files were not saved.',
          'web-shell.RemovedElsewhereService.dismiss': 'Dismiss'
        })
      ],
      providers: [
        {
          provide: RemovedRepositoriesService,
          useValue: { watch: (shown: RemovedRepositoryViewer) => (viewer = shown) }
        },
        { provide: ToastService, useValue: { show } },
        { provide: DialogService, useValue: { closeAll } }
      ]
    });
  });

  it('says that the repository on screen was removed, with the name the page shows', () => {
    showPage({ repository: () => ({ id: 7, name: 'handbook' }) });

    expect(viewer?.repositoryId()).toBe(7);
    viewer?.removed();

    expect(closeAll).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith({
      message: 'Repository handbook removed.',
      dismissLabel: 'Dismiss',
      status: 'info'
    });
  });

  it('drops the waiting saves and says that they were not saved', () => {
    const dropUnsaved = vi.fn(() => true);
    showPage({ repository: () => ({ id: 7, name: 'handbook' }), dropUnsaved });

    viewer?.removed();

    expect(dropUnsaved).toHaveBeenCalledExactlyOnceWith(7);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Repository handbook removed. Your unsaved changes to its files were not saved.',
      status: 'warning'
    }));
  });

  it('shows no repository while the page has none', () => {
    showPage({ repository: () => null });

    expect(viewer?.repositoryId()).toBeNull();
  });
});
