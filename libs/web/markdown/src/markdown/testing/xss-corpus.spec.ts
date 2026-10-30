import { renderSafeHtml } from '../pipeline/render-safe-html';
import { purifyHtml } from '../purify/purify-html';
import { checkAddress, isAddressAttribute } from '../whitelist/addresses';
import { allowedAttributes } from '../whitelist/derive';
import { SAFE_HTML } from '../whitelist/safe-html';
import { corpusFile, PLACEMENTS, XSS_CORPUS } from './xss-corpus';

/** What in `html` breaks SH-21 once a browser parses it: tags, attributes, classes or addresses outside the whitelist. */
function problems(html: string): string[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  const found: string[] = [];
  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    const tag = element.localName;
    if (!SAFE_HTML.tags.includes(tag)) {
      found.push(`<${tag}>`);
    }
    const allowed = [ ...allowedAttributes(tag), ...(SAFE_HTML.pipeline.attributes[tag] ?? []), 'class' ];
    for (const { name, value } of Array.from(element.attributes)) {
      if (name === 'style' || name.startsWith('on') || !allowed.includes(name)) {
        found.push(`${tag}[${name}]`);
      } else if (isAddressAttribute(name)) {
        const check = checkAddress(name, value);
        if (!check.allowed || check.value !== value) {
          found.push(`${tag}[${name}=${value}]`);
        }
      } else if (name === 'class') {
        const classes = [ ...(SAFE_HTML.pipeline.classes[tag] ?? []) ];
        const pattern = tag === 'code' ? SAFE_HTML.values['class'] : undefined;
        for (const className of value.split(/\s+/)) {
          if (!classes.includes(className) && !pattern?.test(className)) {
            found.push(`${tag}.${className}`);
          }
        }
      } else if ((name === 'id' || name === 'name') && !value.startsWith(SAFE_HTML.idPrefix)) {
        found.push(`${tag}[${name}=${value}]`);
      }
    }
  }
  return found;
}

describe('the XSS corpus', () => {
  const files = XSS_CORPUS.flatMap(payload => PLACEMENTS.map(place => place(payload)));

  it('AC-EDIT-002.16: removes every XSS payload in both steps', () => {
    const firstStep: [ string, string[] ][] = [];
    const bothSteps: [ string, string[] ][] = [];
    for (const file of files) {
      const { html } = renderSafeHtml(file);
      const first = problems(html);
      if (first.length > 0) {
        firstStep.push([ file, first ]);
      }
      const both = problems(String(purifyHtml(html)));
      if (both.length > 0) {
        bothSteps.push([ file, both ]);
      }
    }

    // SH-21: nothing hostile reaches DOMPurify.
    expect(firstStep).toEqual([]);
    expect(bothSteps).toEqual([]);
    // Renders every payload in every placement: slow when other tests share the machine.
  }, 30_000);

  it('removes every XSS payload in the second step alone', () => {
    const failures = XSS_CORPUS.map(payload => [ payload, problems(String(purifyHtml(payload))) ] as const)
      .filter(([ , found ]) => found.length > 0);

    expect(failures).toEqual([]);
  });

  it('checks for what it is meant to find', () => {
    expect(problems('<script></script><a href="javascript:x" onclick="y" style="z" id="app" class="evil">a</a>'))
      .toEqual([
        '<script>',
        'a[href=javascript:x]',
        'a[onclick]',
        'a[style]',
        'a[id=app]',
        'a.evil'
      ]);
  });

  it('is the end-to-end test\'s fixture', async () => {
    // Written by `vitest -u`; the end-to-end test renders it (AC-EDIT-002.16).
    await expect(corpusFile()).toMatchFileSnapshot('../../../../../../apps/web-e2e/src/support/fixtures/xss-corpus.md');
  });
});
