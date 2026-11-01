import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { AddRepositoryGuideComponent } from './add-repository-guide.component';

const KEY = 'web-feature-dashboard.AddRepositoryGuideComponent';

describe('AddRepositoryGuideComponent', () => {
  let fixture: ComponentFixture<AddRepositoryGuideComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const steps = () => host().querySelectorAll('ol > li');
  const howItWorks = () => host().querySelector('button[aria-expanded]') as HTMLButtonElement | null;

  async function render(form: 'full' | 'compact'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ AddRepositoryGuideComponent, translocoTesting() ],
      providers: [ provideRouter([]) ]
    }).compileComponents();
    fixture = TestBed.createComponent(AddRepositoryGuideComponent);
    fixture.componentRef.setInput('form', form);
    await settle(fixture);
  }

  describe('full', () => {
    beforeEach(() => render('full'));

    it('shows the three steps', () => {
      expect(host().querySelector('h2')?.textContent?.trim()).toBe(`${KEY}.heading`);
      expect(host().textContent).toContain(`${KEY}.explanation`);
      expect(steps()).toHaveLength(3);
      expect(steps()[0]?.textContent).toContain(`${KEY}.copyUrl`);
      expect(steps()[1]?.textContent).toContain(`${KEY}.credentials`);
      expect(steps()[2]?.textContent).toContain(`${KEY}.cloneMode`);
      expect(howItWorks()).toBeNull();
    });

    it('links Add repository to /repositories/new', () => {
      const link = host().querySelector('a[uiButton]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/repositories/new');
      expect(link.textContent?.trim()).toBe(`${KEY}.add`);
    });
  });

  describe('compact', () => {
    beforeEach(() => render('compact'));

    it('shows one strip with its text', () => {
      expect(host().textContent).toContain(`${KEY}.compactText`);
      expect(host().querySelector('h2')).toBeNull();
    });

    it('toggles How it works in place', async () => {
      const button = howItWorks() as HTMLButtonElement;
      const panel = () => host().querySelector(`#${button.getAttribute('aria-controls')}`) as HTMLElement | null;
      expect(button.textContent?.trim()).toBe(`${KEY}.howItWorks`);
      expect(button.getAttribute('aria-expanded')).toBe('false');
      // In the document while closed, so that aria-controls names it, but inert.
      expect(panel()?.hasAttribute('inert')).toBe(true);
      expect(panel()?.textContent).toContain(`${KEY}.explanation`);

      button.click();
      await settle(fixture);

      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(panel()?.hasAttribute('inert')).toBe(false);
      expect(steps()).toHaveLength(3);
      expect(panel()?.contains(steps()[0] as Node)).toBe(true);

      button.click();
      await settle(fixture);

      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(panel()?.hasAttribute('inert')).toBe(true);
    });

    it('keeps one chevron, which CSS turns while the guide is open', async () => {
      const button = howItWorks() as HTMLButtonElement;
      const chevron = () => button.querySelector('use')?.getAttribute('href') ?? '';
      expect(chevron()).toMatch(/#chevron-right$/);

      button.click();
      await settle(fixture);

      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(chevron()).toMatch(/#chevron-right$/);
    });

    it('ends closed after two quick clicks on How it works', async () => {
      const button = howItWorks() as HTMLButtonElement;

      button.click();
      button.click();
      await settle(fixture);

      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(host().querySelector(`#${button.getAttribute('aria-controls')}`)?.hasAttribute('inert')).toBe(true);
    });

    it('links Add repository to /repositories/new', () => {
      expect((host().querySelector('a[uiButton]') as HTMLAnchorElement).getAttribute('href')).toBe(
        '/repositories/new'
      );
    });
  });
});
