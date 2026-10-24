import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TokenOverviewComponent, TokenSection } from './token-overview.component';

describe('TokenOverviewComponent', () => {
  let fixture: ComponentFixture<TokenOverviewComponent>;
  let style: HTMLStyleElement;

  const render = async (section: TokenSection): Promise<HTMLElement> => {
    fixture.componentRef.setInput('section', section);
    await fixture.whenStable();
    return fixture.nativeElement;
  };

  beforeEach(async () => {
    style = document.createElement('style');
    style.textContent = `
      :root { --ui-neutral-20: #333; --ui-blue-55: #36c; --ui-space-1: 0.25rem; --ui-font-size-sm: 0.8125rem; }
      :root, [data-theme='light'] { --ui-text-default: var(--ui-neutral-20); }
    `;
    document.head.append(style);

    await TestBed.configureTestingModule({
      imports: [ TokenOverviewComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(TokenOverviewComponent);
  });

  afterEach(() => {
    style.remove();
    vi.restoreAllMocks();
  });

  it('lists the colour primitives by hue', async () => {
    const element = await render('primitives');

    const hues = Array.from(element.querySelectorAll('.ramp h3')).map(heading => heading.textContent?.trim());
    expect(hues).toEqual([ 'neutral', 'blue' ]);
  });

  it('groups semantic colours, with a column for each scheme', async () => {
    const element = await render('colours');

    expect(element.querySelector('caption')?.textContent).toContain('Text');
    expect(element.querySelectorAll('tbody td[data-theme]').length).toBe(2);
  });

  it('shows the computed value of layout tokens', async () => {
    const element = await render('layout');

    expect(element.querySelector('tbody td code')?.textContent).toBe('0.25rem');
  });

  it('shows the contrast table even when nothing can be measured', async () => {
    // jsdom has no canvas; the Storybook story measures in a real browser.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const element = await render('contrast');

    expect(element.querySelector('table caption')?.textContent).toContain('Contrast');
    expect(element.querySelectorAll('tbody tr').length).toBe(0);
  });
});
