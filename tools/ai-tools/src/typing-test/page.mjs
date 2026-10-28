// The typing test page (docs/wiki/typing-test.md): CodeMirror 6 set up as A-8.11 plans
// for the editor, and two meters of the time from each keystroke to its frame (NF-2.4): our
// own, which stops when the main thread has made the frame, and the browser's Event Timing,
// which stops when the frame is on screen.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import {
  formatResults,
  parseSetup,
  setupQuery,
  SETUPS,
  summarise,
  SWITCHES,
  TYPING_TEST_FILES
} from '../lib/typing-test.mjs';

/** A keystroke not followed by a change of the text within this long is dropped (a key that edits nothing). */
const PENDING_TIMEOUT_MS = 1000;
/** Quiet time after the first render before the page says "ready". */
const SETTLE_MS = 1500;

const $ = id => document.getElementById(id);
const status = $('status');
const stats = $('stats');
const results = $('results');
/** The file and the switched-off parts, from the address: changing either reloads the page. */
const setup = parseSetup(location.search);

let file = null;
let bytes = 0;
let durations = [];
/** When each measured keystroke started, for the typing speed. */
let starts = [];
let eventTiming = 'PerformanceEventTiming' in window ? [] : null;
let position = null;
/** The time stamp of the oldest keystroke still waiting for its frame. */
let pending = null;
let pendingTimer = 0;

/** Runs `callback` just after the next frame is painted: a task queued from requestAnimationFrame. */
function afterNextPaint(callback) {
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = callback;
    channel.port2.postMessage(null);
  });
}

function startKeystroke(event) {
  if (pending === null) {
    pending = event.timeStamp;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => (pending = null), PENDING_TIMEOUT_MS);
  }
}

/** Keys that change the text; arrows, modifiers and shortcuts do not count. */
function isEditingKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  return event.key.length === 1
    || [ 'Enter', 'Backspace', 'Delete', 'Tab', 'Process', 'Unidentified' ].includes(event.key);
}

const measure = EditorView.updateListener.of(update => {
  if (!update.docChanged || pending === null) {
    return;
  }
  const start = pending;
  pending = null;
  clearTimeout(pendingTimer);
  if (position === null) {
    position = Math.round((update.state.selection.main.head / update.state.doc.length) * 100);
  }
  afterNextPaint(() => {
    durations.push(performance.now() - start);
    starts.push(start);
    showStats();
  });
});

const listen = EditorView.domEventHandlers({
  keydown(event) {
    if (isEditingKey(event)) {
      startKeystroke(event);
    }
  },
  beforeinput(event) {
    startKeystroke(event);
  }
});

const view = new EditorView({
  parent: $('editor'),
  state: EditorState.create({ doc: 'Loading…' })
});

/** The editor's setup as A-8.11 plans it, without the parts the address switches off. */
function extensions() {
  const on = name => !setup.off.includes(name);
  const language = on('language') ? [ on('frontmatter') ? yamlFrontmatter({ content: markdown() }) : markdown() ] : [];
  return [
    history(),
    drawSelection(),
    search({ top: true }),
    keymap.of([ ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab ]),
    ...language,
    syntaxHighlighting(defaultHighlightStyle),
    on('wrap') ? EditorView.lineWrapping : [],
    on('direction') ? EditorView.perLineTextDirection.of(true) : [],
    EditorView.contentAttributes.of(
      on('spellcheck')
        ? { spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }
        : { spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }
    ),
    measure,
    listen
  ];
}

if (eventTiming !== null) {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if ([ 'keydown', 'keypress', 'beforeinput', 'input', 'keyup' ].includes(entry.name)) {
        eventTiming.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }
  }).observe({ type: 'event', durationThreshold: 16 });
}

function reset() {
  durations = [];
  starts = [];
  eventTiming = eventTiming === null ? null : [];
  position = null;
  pending = null;
  results.value = '';
  showStats();
}

function showStats() {
  const summary = summarise(durations);
  stats.textContent = summary.count
    ? `${summary.count} keys · median ${summary.median} · p95 ${summary.p95} · max ${summary.max} ms · over 50: ${summary.over}`
    : 'No keystrokes yet';
  stats.classList.toggle('over', summary.over > 0);
}

async function load(name) {
  status.textContent = 'Loading…';
  status.className = 'loading';
  const response = await fetch(`./${name}`, { cache: 'no-store' });
  const text = await response.text();
  file = name;
  bytes = new TextEncoder().encode(text).length;
  view.setState(EditorState.create({ doc: text, extensions: extensions() }));
  reset();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      setTimeout(() => {
        status.textContent = `Ready: ${name}${setup.off.length ? ` · off: ${setup.off.join(', ')}` : ''}`;
        status.className = 'ready';
      }, SETTLE_MS);
    })
  );
}

/** Starts a new run: resets the meter and puts the cursor in the first paragraph line at or after `share` of the file. */
function placeCursor(share) {
  reset();
  const doc = view.state.doc;
  let line = doc.lineAt(Math.floor(doc.length * share));
  while (line.number < doc.lines && !/^[A-Z]/.test(line.text)) {
    line = doc.line(line.number + 1);
  }
  if (share === 1) {
    line = doc.line(doc.lines);
  }
  const head = share === 1 ? doc.length : line.from + Math.floor(line.length / 2);
  view.dispatch({ selection: EditorSelection.cursor(head), effects: EditorView.scrollIntoView(head, { y: 'center' }) });
  view.focus();
}

async function copy() {
  const text = formatResults({
    file,
    bytes,
    position,
    durations,
    starts,
    eventTiming,
    off: setup.off,
    userAgent: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`
  });
  results.value = text;
  try {
    await navigator.clipboard.writeText(text);
    $('copy').textContent = 'Copied';
  } catch {
    // The clipboard API needs a secure context; over plain http on the LAN, copy the selected text.
    results.select();
    $('copy').textContent = document.execCommand('copy') ? 'Copied' : 'Select and copy below';
  }
  setTimeout(() => ($('copy').textContent = 'Copy results'), 2000);
}

for (const name of Object.keys(TYPING_TEST_FILES)) {
  $('file').append(new Option(name, name, false, name === setup.file));
}
for (const off of SETUPS) {
  const value = off.join(',');
  const label = off.length ? `Without ${off.map(name => SWITCHES[name]).join(', ')}` : 'Everything on';
  $('setup').append(new Option(label, value, false, value === setup.off.join(',')));
}
$('file').addEventListener('change', event => {
  location.search = setupQuery({ file: event.target.value, off: setup.off });
});
$('setup').addEventListener('change', event => {
  location.search = setupQuery({ file: setup.file, off: event.target.value ? event.target.value.split(',') : [] });
});
$('start').addEventListener('click', () => placeCursor(0.02));
$('middle').addEventListener('click', () => placeCursor(0.5));
$('end').addEventListener('click', () => placeCursor(1));
$('reset').addEventListener('click', reset);
// The buttons never take the focus, so that the editor keeps it and the on-screen keyboard
// stays connected to it: on Android, focus moved away and back within one tap leaves the
// keyboard open but typing nowhere.
for (const button of document.querySelectorAll('header button')) {
  button.addEventListener('mousedown', event => event.preventDefault());
}
$('copy').addEventListener('click', copy);

if (setup.unknown.length) {
  // Measuring a setup other than the one asked for would give a wrong answer: refuse instead.
  status.textContent = `Unknown switch: ${setup.unknown.join(', ')}`;
  status.className = 'loading';
} else {
  load(setup.file);
}
