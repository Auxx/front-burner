import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';

import { PageTitleService } from './page-title.service';

describe('PageTitleService', () => {
  let service: PageTitleService;
  let published: string[];

  beforeEach(() => {
    service = TestBed.inject(PageTitleService);
    published = [];
    service.changes.subscribe(title => published.push(title));
    document.title = 'Dashboard · Front Burner';
  });

  it('formats a page title', () => {
    expect(service.format('handbook')).toBe('handbook · Front Burner');
    expect(service.format()).toBe('Front Burner');
  });

  it('sets and announces a page\'s own title', () => {
    service.publish('handbook');

    expect(TestBed.inject(Title).getTitle()).toBe('handbook · Front Burner');
    expect(published).toEqual([ 'handbook · Front Burner' ]);
  });

  it('updates a page\'s own title without announcing it', () => {
    service.update('• handbook');

    expect(document.title).toBe('• handbook · Front Burner');
    expect(published).toEqual([]);
  });

  it('sets the product name alone while the page does not know its title, without announcing it', () => {
    service.setPending();

    expect(document.title).toBe('Front Burner');
    expect(published).toEqual([]);
  });
});
