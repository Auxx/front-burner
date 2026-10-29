import { computed, inject, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { NewEntryKind } from '@front-burner/shared-contracts';
import {
  ENTRY_NAME_PROBLEMS,
  type EntryNameProblem,
  entryNameProblem,
  sameEntryName,
  withMarkdownExtension
} from '@front-burner/shared-util';
import { FilesApi } from '@front-burner/web-api-client';
import { type ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';

/** Why a name cannot be used: FB-27's rules, or a clash with a sibling (`name-taken`). */
export type EntryNameError = EntryNameProblem | 'name-taken';

export interface EntryNameFieldOptions {
  readonly kind: NewEntryKind;
  /** The names of the entries in the folder, as listed. */
  readonly siblings: () => readonly string[];
  /** The entry's own name when it is renamed, so that it does not clash with itself (FB-27). */
  readonly current?: string;
}

export interface EntryNameField {
  /** The name the entry gets: in NFC, and for a file with a Markdown extension (FB-28, FB-29). */
  readonly finalName: Signal<string>;
  /** The first problem of the name, or `null` when the client finds none; the backend has the last word (FB-4). */
  readonly problem: Signal<EntryNameError | null>;
}

/**
 * The checks of the name field of **New file**, **New folder** and **Rename**
 * on the name the user types (`name`). The clash is checked against the
 * loaded listing, ignoring case, but never against the entry itself, so that
 * `readme.md` can be renamed to `README.md` (AC-FILE-001.14).
 */
export function entryNameField(name: () => string, options: EntryNameFieldOptions): EntryNameField {
  const finalName = computed(() => {
    const nfc = name().normalize('NFC');
    return options.kind === 'file' && nfc !== '' ? withMarkdownExtension(nfc) : nfc;
  });
  const problem = computed<EntryNameError | null>(() => {
    // The extension can make a name too long.
    const found = entryNameProblem(name()) ?? entryNameProblem(finalName());
    if (found !== null) {
      return found;
    }
    const final = finalName();
    const current = options.current;
    const taken = options.siblings().some(sibling =>
      sameEntryName(sibling, final) && (current === undefined || !sameEntryName(sibling, current))
    );
    return taken ? 'name-taken' : null;
  });
  return { finalName, problem };
}

export interface IgnoredNameOptions {
  readonly repositoryId: number;
  /** The folder the entry is in. */
  readonly folder: string;
  readonly kind: NewEntryKind;
  readonly finalName: Signal<string>;
  /** Whether the name can be asked about; a name with a problem is not. */
  readonly valid: Signal<boolean>;
}

/** How long typing must pause before the backend is asked whether the name is ignored. */
export const IGNORE_CHECK_DELAY = 300;

/**
 * Whether the backend says that the entry would be ignored under its final
 * name (FB-31, FB-34), asked at most once per pause in typing. `false` until
 * it answers, and when it cannot: the warning is only a warning. Call it in an
 * injection context.
 */
export function ignoredEntryName(options: IgnoredNameOptions): Signal<boolean> {
  const api = inject(FilesApi);
  const name = computed(() => options.valid() ? options.finalName() : null);
  return toSignal(
    toObservable(name).pipe(
      debounceTime(IGNORE_CHECK_DELAY),
      distinctUntilChanged(),
      switchMap(final =>
        final === null
          ? of(false)
          : api
            .isIgnored(options.repositoryId, { path: joinPath(options.folder, final), kind: options.kind })
            .pipe(map(result => result.ignored), catchError(() => of(false)))
      )
    ),
    { initialValue: false }
  );
}

/** The path of `name` in `folder`; the root folder is `''`. */
export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/** The codes of the name field that have a text, under `web-feature-repository-screen.nameErrors`. */
const NAME_ERRORS: readonly string[] = [ ...ENTRY_NAME_PROBLEMS, 'name-taken' ];

/** How a failed create or rename is shown (FB-45): under the name field, or in a banner. */
export type EntryRequestFailure =
  | { readonly field: string; }
  | { readonly text: string; readonly reference: string | null; };

/**
 * Where a create or rename failure is shown (FB-45, A-3.9): an error of the
 * name field under the field, by its code (`invalid` for one the client has no
 * text for), anything else in a banner with the API's text.
 */
export function entryRequestFailure(error: unknown, errorText: ApiErrorTextService): EntryRequestFailure {
  const apiError = toApiError(error);
  const field = apiError.fields?.find(item => item.path === 'name');
  if (field) {
    return { field: NAME_ERRORS.includes(field.code) ? field.code : 'invalid' };
  }
  return errorText.describe(apiError);
}
