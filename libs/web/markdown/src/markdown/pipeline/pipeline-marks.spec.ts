import type { Element } from 'hast';
import { visitElements } from './elements';
import { markdownToHast } from './render-safe-html';

/** The elements of a file's tree with their `data.pipeline` and `data-md-pipeline`. */
function elements(markdown: string): [ string, boolean, unknown ][] {
  const result: [ string, boolean, unknown ][] = [];
  visitElements(markdownToHast(markdown), (element: Element) => {
    result.push([ element.tagName, element.data?.pipeline === true, element.properties['dataMdPipeline'] ]);
  });
  return result;
}

describe('pipelineMarks', () => {
  it('marks the elements made from Markdown and no raw HTML', () => {
    expect(elements('*a* <b>b</b>\n\n<div data-md-pipeline="guess">c</div>')).toEqual([
      [ 'p', true, undefined ],
      [ 'em', true, undefined ],
      [ 'b', false, undefined ],
      [ 'div', false, undefined ]
    ]);
  });

  it('marks elements the pipeline makes without a source position', () => {
    expect(elements('- [ ] a')).toContainEqual([ 'input', true, undefined ]);
  });
});
