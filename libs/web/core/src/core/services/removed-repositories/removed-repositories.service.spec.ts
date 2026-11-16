import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { PushEvent } from '@front-burner/shared-contracts';
import { Subject } from 'rxjs';

import { DraftStore } from '../../saving/draft-store';
import { PushChannelService } from '../push-channel/push-channel.service';
import { RemovedRepositoriesService, type RemovedRepositoryViewer } from './removed-repositories.service';

describe('RemovedRepositoriesService', () => {
  let events: Subject<PushEvent>;
  let deleteRepository: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let viewer: RemovedRepositoryViewer | undefined;

  /** A page that watches, showing `viewer`'s repository. */
  @Component({ selector: 'core-watcher', template: '' })
  class WatcherComponent {
    constructor() {
      inject(RemovedRepositoriesService).watch(viewer);
    }
  }

  function watch(shown?: RemovedRepositoryViewer) {
    viewer = shown;
    return TestBed.createComponent(WatcherComponent);
  }

  function removedElsewhere(repositoryId: number): void {
    events.next({ type: 'repository.removed', repositoryId });
  }

  beforeEach(() => {
    events = new Subject();
    deleteRepository = vi.fn(() => Promise.resolve());
    navigateByUrl = vi.fn(() => Promise.resolve(true));
    viewer = undefined;
    TestBed.configureTestingModule({
      providers: [
        { provide: PushChannelService, useValue: { events } },
        { provide: DraftStore, useValue: { deleteRepository } },
        { provide: Router, useValue: { navigateByUrl } }
      ]
    });
  });

  it('goes to the dashboard when the repository on screen is removed elsewhere', () => {
    const removed = vi.fn();
    watch({ repositoryId: () => 7, removed });

    removedElsewhere(7);

    expect(removed).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('deletes this device\'s drafts', () => {
    watch();

    removedElsewhere(7);

    expect(deleteRepository).toHaveBeenCalledWith(7);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('tells the page before deleting the drafts, so that it drops its waiting saves first', () => {
    const order: string[] = [];
    deleteRepository.mockImplementation(() => {
      order.push('drafts');
      return Promise.resolve();
    });
    watch({ repositoryId: () => 7, removed: () => order.push('page') });

    removedElsewhere(7);

    expect(order).toEqual([ 'page', 'drafts' ]);
  });

  it('ignores another repository\'s removal', () => {
    const removed = vi.fn();
    watch({ repositoryId: () => 7, removed });

    removedElsewhere(8);

    expect(removed).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(deleteRepository).toHaveBeenCalledWith(8);
  });

  it('ignores its own removal', () => {
    const removed = vi.fn();
    watch({ repositoryId: () => 7, removed });
    const service = TestBed.inject(RemovedRepositoriesService);

    service.expect(7);
    removedElsewhere(7);

    expect(removed).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(deleteRepository).not.toHaveBeenCalled();
  });

  it('follows a removal elsewhere again once its own request failed', () => {
    const removed = vi.fn();
    watch({ repositoryId: () => 7, removed });
    const service = TestBed.inject(RemovedRepositoriesService);

    service.expect(7)();
    removedElsewhere(7);

    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('follows a removal found by a request, as after the event', () => {
    const removed = vi.fn();
    watch({ repositoryId: () => 7, removed });

    TestBed.inject(RemovedRepositoriesService).removed(7);

    expect(removed).toHaveBeenCalledTimes(1);
    expect(deleteRepository).toHaveBeenCalledWith(7);
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('listens only while something watches, and stops telling a page that is gone', () => {
    const removed = vi.fn();
    const fixture = watch({ repositoryId: () => 7, removed });
    expect(events.observed).toBe(true);

    fixture.destroy();
    removedElsewhere(7);

    expect(events.observed).toBe(false);
    expect(removed).not.toHaveBeenCalled();
  });

  it('follows one event once, however many watch', () => {
    const removed = vi.fn();
    watch({ repositoryId: () => 7, removed });
    watch();

    removedElsewhere(7);

    expect(removed).toHaveBeenCalledTimes(1);
    expect(deleteRepository).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
  });
});
