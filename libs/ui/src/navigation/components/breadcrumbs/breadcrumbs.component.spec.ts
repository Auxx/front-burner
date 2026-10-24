import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BreadcrumbDirective } from '../../directives/breadcrumb/breadcrumb.directive';
import { BreadcrumbsComponent } from './breadcrumbs.component';

@Component({
  imports: [ BreadcrumbsComponent, BreadcrumbDirective ],
  template: `
    <ui-breadcrumbs label="Breadcrumb">
      <a *uiBreadcrumb href="/repositories">Repositories</a>
      <a *uiBreadcrumb href="/repositories/1">handbook</a>
      @if (extra()) {
        <span *uiBreadcrumb>Settings</span>
      }
    </ui-breadcrumbs>
  `
})
class HostComponent {
  readonly extra = signal(true);
}

describe('BreadcrumbsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let nav: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    nav = fixture.nativeElement.querySelector('ui-breadcrumbs');
  });

  it('is a labelled navigation landmark with an ordered list', async () => {
    expect(nav.getAttribute('role')).toBe('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(nav.querySelectorAll('ol > li').length).toBe(3);
  });

  it('marks only the last item as the current page', async () => {
    const items = [ ...nav.querySelectorAll('li') ];
    expect(items.map(li => li.getAttribute('aria-current'))).toEqual([ null, null, 'page' ]);
    expect(items[2].textContent?.trim()).toBe('Settings');
  });

  it('moves the current page when items change', async () => {
    fixture.componentInstance.extra.set(false);
    await fixture.whenStable();

    const items = [ ...nav.querySelectorAll('li') ];
    expect(items.length).toBe(2);
    expect(items[1].getAttribute('aria-current')).toBe('page');
    expect(items[0].getAttribute('aria-current')).toBeNull();
  });

  it('does not put separators in the text', async () => {
    expect(nav.textContent).not.toContain('›');
  });
});
