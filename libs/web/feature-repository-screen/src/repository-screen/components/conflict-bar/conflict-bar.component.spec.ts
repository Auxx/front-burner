import { LiveAnnouncer } from '@angular/cdk/a11y';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { createEditorState, type EditorStateChange } from '@front-burner/web-code-editor';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type ConflictAccept, ConflictBarComponent } from './conflict-bar.component';

type EditorState = EditorStateChange['state'];

const K = 'web-feature-repository-screen.ConflictBarComponent';

const CONFLICT = (n: number) => `<<<<<<< main\nmine ${n}\n=======\ntheirs ${n}\n>>>>>>> origin/main`;
const TEXT = `intro\n${CONFLICT(1)}\nbetween\n${CONFLICT(2)}\nmore\n${CONFLICT(3)}\nend\n`;

function stateOf(content: string, cursor = 0): EditorState {
  const state = createEditorState({
    content,
    highlight: false,
    label: 'guide.md',
    conflicts: {
      ours: branch => `Mine (${branch})`,
      theirs: branch => `Theirs (${branch})`,
      acceptOurs: 'Accept mine',
      acceptTheirs: 'Accept theirs',
      acceptBoth: 'Accept both'
    }
  });
  return state.update({ selection: { anchor: cursor } }).state;
}

describe('ConflictBarComponent', () => {
  let fixture: ComponentFixture<ConflictBarComponent>;
  let moves: number[];
  let accepts: ConflictAccept[];
  let announced: string[];

  const host = () => fixture.nativeElement as HTMLElement;
  const position = () => host().querySelector('.position')?.textContent?.trim();
  const button = (name: string) =>
    Array.from(host().querySelectorAll('button')).find(item => item.textContent?.trim() === name) as HTMLButtonElement;
  const available = (name: string) => button(name).getAttribute('aria-disabled') !== 'true';

  async function show(state: EditorState): Promise<void> {
    fixture.componentRef.setInput('state', state);
    await settle(fixture);
  }

  beforeEach(async () => {
    moves = [];
    accepts = [];
    announced = [];
    TestBed.configureTestingModule({
      imports: [
        ConflictBarComponent,
        translocoTesting({
          [`${K}.label`]: 'Conflicts',
          [`${K}.at`]: 'Conflict {{ index }} of {{ total }}',
          [`${K}.count`]: '{{ count }} conflicts',
          [`${K}.none`]: 'No conflict markers left.',
          [`${K}.moved`]: 'Conflict {{ index }} of {{ total }}: mine and theirs',
          [`${K}.previous`]: 'Previous',
          [`${K}.next`]: 'Next',
          [`${K}.acceptOurs`]: 'Accept mine',
          [`${K}.acceptTheirs`]: 'Accept theirs',
          [`${K}.acceptBoth`]: 'Accept both'
        })
      ],
      providers: [
        { provide: LiveAnnouncer, useValue: { announce: (text: string) => announced.push(text) } }
      ]
    });
    fixture = TestBed.createComponent(ConflictBarComponent);
    fixture.componentInstance.move.subscribe(index => moves.push(index));
    fixture.componentInstance.accept.subscribe(accept => accepts.push(accept));
  });

  it('says which conflict has the cursor', async () => {
    await show(stateOf(TEXT, TEXT.indexOf('theirs 2')));

    expect(position()).toBe('Conflict 2 of 3');
    expect(host().querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Conflicts');
  });

  it('moves to the next and the previous', async () => {
    await show(stateOf(TEXT, TEXT.indexOf('mine 2')));

    button('Next').click();
    button('Previous').click();
    expect(moves).toEqual([ 2, 0 ]);

    await show(stateOf(TEXT, TEXT.indexOf('mine 1')));
    expect(available('Previous')).toBe(false);
    expect(available('Next')).toBe(true);
    button('Previous').click();
    expect(moves).toEqual([ 2, 0 ]);

    await show(stateOf(TEXT, TEXT.indexOf('mine 3')));
    expect(available('Next')).toBe(false);
  });

  it('goes to the nearest with the cursor outside', async () => {
    await show(stateOf(TEXT, TEXT.indexOf('between')));

    expect(position()).toBe('3 conflicts');
    expect([ 'Accept mine', 'Accept theirs', 'Accept both' ].map(available)).toEqual([ false, false, false ]);
    button('Previous').click();
    button('Next').click();
    expect(moves).toEqual([ 0, 1 ]);

    await show(stateOf(TEXT, 0));
    expect(available('Previous')).toBe(false);
    button('Next').click();
    expect(moves).toEqual([ 0, 1, 0 ]);
  });

  it('says when no markers are left', async () => {
    await show(stateOf('# Title\n\nAll resolved.\n'));

    expect(position()).toBe('No conflict markers left.');
    expect(available('Previous')).toBe(false);
    expect(available('Next')).toBe(false);
  });

  it('accepts with the keyboard the conflict at the cursor', async () => {
    await show(stateOf(TEXT, TEXT.indexOf('theirs 3')));

    for (const name of [ 'Accept mine', 'Accept theirs', 'Accept both' ]) {
      button(name).focus();
      // A button's Enter and Space are its click.
      button(name).click();
    }

    expect(accepts).toEqual([
      { index: 2, choice: 'ours' },
      { index: 2, choice: 'theirs' },
      { index: 2, choice: 'both' }
    ]);
    expect(host().querySelectorAll('button[tabindex="-1"]')).toHaveLength(0);
  });

  it('announces each move, and the count when it changes', async () => {
    await show(stateOf(TEXT, 0));
    expect(announced).toEqual([]);

    button('Next').click();
    await show(stateOf(TEXT, TEXT.indexOf('<<<<<<<')));
    expect(announced).toEqual([ 'Conflict 1 of 3: mine and theirs' ]);

    const fewer = TEXT.replace(`${CONFLICT(1)}\n`, 'mine 1\n');
    await show(stateOf(fewer, 0));
    expect(announced).toEqual([ 'Conflict 1 of 3: mine and theirs', '2 conflicts' ]);

    await show(stateOf('done\n', 0));
    expect(announced.at(-1)).toBe('No conflict markers left.');
  });

  it('meets the touch target size', async () => {
    await show(stateOf(TEXT, TEXT.indexOf('mine 1')));

    // The ui library's buttons: the small size is 24 CSS pixels in the compact density and
    // 44 in the touch one (NF-13.5), and no button is drawn smaller.
    const buttons = Array.from(host().querySelectorAll('button'));
    expect(buttons).toHaveLength(5);
    for (const item of buttons) {
      expect(item.dataset['size']).toBe('small');
    }
  });
});
