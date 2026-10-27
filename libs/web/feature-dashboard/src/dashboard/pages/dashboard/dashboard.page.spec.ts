import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { DashboardPage } from './dashboard.page';

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ DashboardPage, translocoTesting() ] }).compileComponents();
    fixture = TestBed.createComponent(DashboardPage);
    await settle(fixture);
  });

  it('has one h1, "Dashboard", that takes the focus after navigation', () => {
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelector('h1')?.textContent?.trim()).toBe('web-feature-dashboard.DashboardPage.heading');
    expect(page.querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  });

  it('is not a main landmark of its own: the shell has it', () => {
    expect((fixture.nativeElement as HTMLElement).querySelector('main')).toBeNull();
  });
});
