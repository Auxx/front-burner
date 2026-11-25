import { CSP_NONCE } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ChunkPreloaderService } from './chunk-preloader.service';

describe('ChunkPreloaderService', () => {
  afterEach(() => {
    document.head.querySelectorAll('#fb-chunk-map, link[rel="modulepreload"]').forEach(element => element.remove());
  });

  /** The map as the server writes it into `index.html` (A-7.9). */
  function serveMap(text: string): void {
    const script = document.createElement('script');
    script.type = 'application/json';
    script.id = 'fb-chunk-map';
    script.textContent = text;
    document.head.append(script);
  }

  function create(nonce: string | null = 'n0nce'): ChunkPreloaderService {
    TestBed.configureTestingModule({ providers: [ { provide: CSP_NONCE, useValue: nonce } ] });
    return TestBed.inject(ChunkPreloaderService);
  }

  const preloads = () =>
    [ ...document.head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]') ].map(link => ({
      href: link.getAttribute('href'),
      nonce: link.getAttribute('nonce')
    }));

  it('adds a modulepreload per file of the group, with the nonce', () => {
    serveMap('{"editor":["chunk-editor01.js","chunk-cm000001.js"]}');

    create().preload('editor');

    expect(preloads()).toEqual([
      { href: 'chunk-editor01.js', nonce: 'n0nce' },
      { href: 'chunk-cm000001.js', nonce: 'n0nce' }
    ]);
  });

  it('adds each file only once, also when the server preloaded it already', () => {
    serveMap('{"editor":["chunk-editor01.js","chunk-cm000001.js"]}');
    const served = document.createElement('link');
    served.rel = 'modulepreload';
    served.setAttribute('href', 'chunk-cm000001.js');
    document.head.append(served);
    const preloader = create();

    preloader.preload('editor');
    preloader.preload('editor');

    expect(preloads().map(link => link.href)).toEqual([ 'chunk-cm000001.js', 'chunk-editor01.js' ]);
  });

  it.each([
    [ 'without a map', undefined ],
    [ 'with one that does not parse', '{"editor":' ],
    [ 'with one whose group is not a list of names', '{"editor":"chunk-editor01.js"}' ]
  ])('does nothing %s', (_case, text) => {
    if (text !== undefined) {
      serveMap(text);
    }

    expect(() => create().preload('editor')).not.toThrow();
    expect(preloads()).toEqual([]);
  });
});
