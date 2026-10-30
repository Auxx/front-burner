import type { Root } from 'hast';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { SAFE_HTML } from '../whitelist/safe-html';
import { collectRemovals, type RemovalReport } from './collect-removals';
import { pipelineMarks } from './pipeline-marks';
import { rehypeSafeHtml } from './rehype-safe-html';

/** The preview's HTML of a Markdown file, and what was removed from it. */
export interface SafeHtml {
  html: string;
  removals: RemovalReport;
}

const marks = pipelineMarks();

// CommonMark with the GitHub extensions and front matter (ED-26), raw HTML
// parsed as a browser would (SH-10). `.mdx` files take the same path (ED-29).
const toHast = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter)
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: SAFE_HTML.idPrefix })
  .use(marks.mark)
  .use(rehypeRaw)
  .use(marks.find)
  .freeze();

const toSafeHtml = unified().use(rehypeSafeHtml).use(rehypeStringify).freeze();

/** The syntax tree of a Markdown file, with its raw HTML parsed and nothing sanitised yet. */
export function markdownToHast(markdown: string): Root {
  return toHast.runSync(toHast.parse(markdown));
}

/** Renders Markdown as HTML that holds only what the safe HTML whitelist allows (REQ-EDIT-002). */
export function renderSafeHtml(markdown: string): SafeHtml {
  const tree = markdownToHast(markdown);
  const removals = collectRemovals(tree);
  const safe = toSafeHtml.runSync(tree);
  return { html: toSafeHtml.stringify(safe), removals };
}
