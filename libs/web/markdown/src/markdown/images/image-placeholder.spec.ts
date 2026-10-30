import { createPlaceholder, setPlaceholderContent } from './image-placeholder';

function img(html: string): HTMLImageElement {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild as HTMLImageElement;
}

describe('createPlaceholder', () => {
  it('shows the alt text and the reason, as text', () => {
    const placeholder = createPlaceholder(img('<img alt="<b>Logo</b>">'), {
      alt: '<b>Logo</b>',
      reason: 'Image not found: <i>a.png</i>'
    });

    expect(placeholder.getAttribute('role')).toBe('img');
    expect(placeholder.getAttribute('aria-label')).toBe('<b>Logo</b>, Image not found: <i>a.png</i>');
    expect(placeholder.querySelector('b, i')).toBeNull();
    expect(Array.from(placeholder.children, child => child.textContent)).toEqual([
      '<b>Logo</b>',
      'Image not found: <i>a.png</i>'
    ]);
  });

  it('adds a detail after the reason', () => {
    const placeholder = createPlaceholder(img('<img>'), {
      alt: '',
      reason: 'Remote image couldn\'t be loaded',
      detail: 'a.io'
    });

    expect(placeholder.getAttribute('aria-label')).toBe('Remote image couldn\'t be loaded a.io');
    expect(placeholder.textContent).toBe('Remote image couldn\'t be loadeda.io');
  });

  it('is named by the alt text while loading, and hidden without one', () => {
    const loading = createPlaceholder(img('<img alt="Flow">'), { alt: 'Flow', reason: null });
    const decorative = createPlaceholder(img('<img>'), { alt: '', reason: null });

    expect(loading.hasAttribute('data-loading')).toBe(true);
    expect(loading.getAttribute('aria-label')).toBe('Flow');
    expect(loading.textContent).toBe('');
    expect(decorative.getAttribute('aria-hidden')).toBe('true');
    expect(decorative.hasAttribute('role')).toBe(false);
    setPlaceholderContent(decorative, { alt: '', reason: 'Can\'t show this image' });
    expect(decorative.hasAttribute('aria-hidden')).toBe(false);
    expect(decorative.hasAttribute('data-loading')).toBe(false);
    expect(decorative.getAttribute('aria-label')).toBe('Can\'t show this image');
  });

  it('reserves the size of the image', () => {
    const both = createPlaceholder(img('<img width="200" height="100">'), { alt: '', reason: null });
    const percent = createPlaceholder(img('<img width="50%" height="100">'), { alt: '', reason: null });
    const height = createPlaceholder(img('<img height="80">'), { alt: '', reason: null });
    const none = createPlaceholder(img('<img>'), { alt: '', reason: null });

    expect([ both.style.inlineSize, both.style.aspectRatio ]).toEqual([ '200px', '200 / 100' ]);
    expect([ percent.style.inlineSize, percent.style.aspectRatio ]).toEqual([ '50%', '' ]);
    expect(height.style.blockSize).toBe('80px');
    expect(none.hasAttribute('style')).toBe(false);
  });
});
