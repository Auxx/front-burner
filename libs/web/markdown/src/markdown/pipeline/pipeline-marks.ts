import type { Root } from 'hast';
import { visitElements } from './elements';

declare module 'hast' {
  interface ElementData {
    /** The pipeline made this element from Markdown syntax: it is not raw HTML (SH-5). */
    pipeline?: boolean;
  }
}

/** The property that carries the mark through `rehype-raw`: `data-md-pipeline` in HTML. */
const MARK = 'dataMdPipeline';

/** The two plugins that tell the pipeline's own elements from raw HTML. */
export interface PipelineMarks {
  /** Runs right before `rehype-raw`, when every element is the pipeline's. */
  mark: () => (tree: Root) => void;
  /** Runs right after `rehype-raw`: sets `data.pipeline` on the elements that kept their mark. */
  find: () => (tree: Root) => void;
}

/**
 * Before `rehype-raw`, raw HTML is still text in `raw` nodes, so every element
 * in the tree is the pipeline's. `mark` gives each one an attribute with a
 * random value, new for every run, that a file cannot guess; `find` then knows
 * the pipeline's elements by it and removes it from every element. Source
 * positions cannot tell them apart: elements that the HTML parser makes up,
 * such as an unclosed raw `<a>` copied into the next paragraph, have none,
 * just like the pipeline's footnote list and checkboxes.
 */
export function pipelineMarks(): PipelineMarks {
  let nonce = '';
  return {
    mark: () => tree => {
      nonce = randomNonce();
      visitElements(tree, element => void (element.properties[MARK] = nonce));
    },
    find: () => tree => {
      visitElements(tree, element => {
        if (nonce && element.properties[MARK] === nonce) {
          element.data = { ...element.data, pipeline: true };
        }
        delete element.properties[MARK];
      });
      nonce = '';
    }
  };
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
