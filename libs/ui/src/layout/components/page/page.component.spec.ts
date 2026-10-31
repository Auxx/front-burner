import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BreadcrumbDirective } from '../../../navigation/directives/breadcrumb/breadcrumb.directive';
import { PageTitleDirective } from '../../directives/page-title/page-title.directive';
import { PageComponent } from './page.component';

@Component({
  imports: [ PageComponent, PageTitleDirective, BreadcrumbDirective ],
  template: `
    <ui-page breadcrumbsLabel="Breadcrumb" [column]="column()">
      @if (ancestors()) {
        <a *uiBreadcrumb href="/repositories">Repositories</a>
      }
      <h1 uiPageTitle>Add repository</h1>
      <form class="form"></form>
    </ui-page>
  `
})
class HostComponent {
  readonly column = input<string | null>(null);
  readonly ancestors = signal(true);
}

describe('PageComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let root: HTMLElement;

  const nav = () => root.querySelector('nav');
  const h1 = () => root.querySelector('h1') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    root = fixture.nativeElement;
  });

  it('puts the ancestors in a nav and the h1 after it, outside the nav', () => {
    expect(nav()?.getAttribute('aria-label')).toBe('Breadcrumb');
    const links = [ ...(nav()?.querySelectorAll('ol > li a') ?? []) ];
    expect(links.map(link => link.textContent?.trim())).toEqual([ 'Repositories' ]);
    expect(nav()?.contains(h1())).toBe(false);
    expect(h1().previousElementSibling).toBe(nav());
    expect(h1().textContent?.trim()).toBe('Add repository');
  });

  it('does not put separators in the text', () => {
    expect(root.textContent).not.toContain('›');
  });

  it('renders no nav without ancestors', async () => {
    fixture.componentInstance.ancestors.set(false);
    await fixture.whenStable();

    expect(nav()).toBeNull();
    expect(h1()).not.toBeNull();
  });

  it('wraps everything in one ui-island', () => {
    const islands = root.querySelectorAll('ui-island');
    expect(islands).toHaveLength(1);
    expect(islands[0].contains(h1())).toBe(true);
    expect(islands[0].contains(root.querySelector('.form'))).toBe(true);
  });

  it('puts the content after the title bar', () => {
    const form = root.querySelector('.form') as HTMLElement;
    expect(h1().compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('centres the content in a column of the given width', async () => {
    const column = () => root.querySelector('.column') as HTMLElement;
    expect(column().style.maxInlineSize).toBe('');

    fixture.componentRef.setInput('column', '40rem');
    await fixture.whenStable();

    expect(column().style.maxInlineSize).toBe('40rem');
    expect(column().contains(h1())).toBe(true);
    expect(column().contains(root.querySelector('.form'))).toBe(true);
  });
});
