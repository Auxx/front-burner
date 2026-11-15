import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { LastAccessedComponent } from './last-accessed.component';

const KEY = 'web-shell.LastAccessedComponent';
const AT = '2026-10-26T10:00:00.000Z';

describe('LastAccessedComponent', () => {
  let fixture: ComponentFixture<LastAccessedComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const time = () => host().querySelector('time') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ LastAccessedComponent, translocoTesting() ]
    }).compileComponents();
    fixture = TestBed.createComponent(LastAccessedComponent);
    fixture.componentRef.setInput('at', AT);
    await settle(fixture);
  });

  it('shows the relative time and the exact time on focus', () => {
    expect(host().textContent).toContain(`${KEY}.label`);
    expect(time().getAttribute('datetime')).toBe(AT);
    expect(time().textContent?.trim()).toMatch(/ago$|^yesterday$/);

    const exact = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(AT));
    expect(time().getAttribute('tabindex')).toBe('0');
    const description = document.getElementById(time().getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe(exact);
  });
});
