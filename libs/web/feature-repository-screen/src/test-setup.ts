import { NgModule } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { PREVIEW_WORKER } from '@front-burner/web-markdown';

/** jsdom has no workers: the preview's worker takes every update and never answers. */
class InertWorker extends EventTarget {
  postMessage(): void {
    // Never answers.
  }

  terminate(): void {
    // Nothing to stop.
  }
}

@NgModule({ providers: [ { provide: PREVIEW_WORKER, useValue: () => new InertWorker() as unknown as Worker } ] })
class InertPreviewWorkerModule {}

getTestBed().initTestEnvironment([ BrowserTestingModule, InertPreviewWorkerModule ], platformBrowserTesting(), {
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true
});

// jsdom has no layout for ranges, which CodeMirror measures to draw the selection.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
