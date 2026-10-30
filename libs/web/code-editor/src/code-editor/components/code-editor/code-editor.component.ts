import {
  ChangeDetectionStrategy,
  Component,
  CSP_NONCE,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  ViewEncapsulation
} from '@angular/core';
import { openSearchPanel } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export interface EditorStateChange {
  state: EditorState;
  docChanged: boolean;
}

/**
 * The one CodeMirror view of a screen. It shows whatever state it is given and reports
 * every new state, so that the caller keeps one state per file and with it each file's
 * undo history and cursor (A-8.15, ED-8).
 *
 * Its styles are not encapsulated: CodeMirror builds its own DOM, which Angular's scoped
 * styles never reach.
 */
@Component({
  selector: 'ce-code-editor',
  template: '',
  styleUrl: './code-editor.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CodeEditorComponent {
  readonly state = input.required<EditorState>();
  readonly stateChange = output<EditorStateChange>();
  /** The place at the top (`topPlace`) after each scroll. */
  readonly scrolled = output<number>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly nonce = inject(CSP_NONCE, { optional: true });
  private view?: EditorView;

  constructor() {
    effect(() => this.show(this.state()));

    // Keeps the cursor above the on-screen keyboard when it shrinks the visual viewport (ED-15).
    const viewport = typeof window === 'undefined' ? null : window.visualViewport;
    const keepCursorInView = () => {
      if (this.view?.hasFocus) {
        this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head) });
      }
    };
    viewport?.addEventListener('resize', keepCursorInView);

    inject(DestroyRef).onDestroy(() => {
      viewport?.removeEventListener('resize', keepCursorInView);
      this.view?.destroy();
    });
  }

  /** Opens the find and replace panel (ED-11). */
  openSearch(): void {
    if (this.view) {
      openSearchPanel(this.view);
    }
  }

  focus(): void {
    this.view?.focus();
  }

  /**
   * Scrolls so that the line (1-based) is at the top, and a fractional line
   * that share of the line's height further (ED-35); does nothing for a line
   * that is not a number.
   */
  scrollToLine(line: number): void {
    if (this.view && Number.isFinite(line)) {
      const { doc } = this.view.state;
      const number = Math.min(Math.max(1, Math.floor(line)), doc.lines);
      const { from } = doc.line(number);
      const share = number === Math.floor(line) ? line - number : 0;
      const yMargin = -share * this.view.lineBlockAt(from).height;
      this.view.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'start', yMargin }) });
    }
  }

  /** The first visible line (1-based). */
  topLine(): number {
    return Math.floor(this.topPlace());
  }

  /**
   * The place at the top as a fractional line: the first visible line plus
   * the share of its height scrolled past, so `12.5` is half-way down line 12
   * (ED-35).
   */
  topPlace(): number {
    if (!this.view) {
      return 1;
    }
    const height = Math.max(0, this.view.scrollDOM.getBoundingClientRect().top - this.view.documentTop);
    const block = this.view.lineBlockAtHeight(height);
    const share = block.height > 0 ? Math.min(Math.max((height - block.top) / block.height, 0), 0.999) : 0;
    return this.view.state.doc.lineAt(block.from).number + share;
  }

  private show(state: EditorState): void {
    this.view ??= this.createView();
    if (this.view.state !== state) {
      this.view.setState(state);
    }
  }

  private createView(): EditorView {
    const view = new EditorView({
      parent: this.host,
      // The first state carries the page's CSP nonce, so that CodeMirror's style element
      // gets it whatever the given states hold (NF-11.1).
      state: EditorState.create({ extensions: EditorView.cspNonce.of(this.nonce ?? '') }),
      dispatchTransactions: (transactions, view) => {
        view.update(transactions);
        this.stateChange.emit({
          state: view.state,
          docChanged: transactions.some(transaction => transaction.docChanged)
        });
      }
    });
    view.scrollDOM.addEventListener('scroll', () => this.scrolled.emit(this.topPlace()), { passive: true });
    return view;
  }
}
