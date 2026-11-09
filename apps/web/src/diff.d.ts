declare module 'diff' {
  export interface Change {
    value: string;
    added?: boolean;
    removed?: boolean;
    count?: number;
  }

  export function diffWordsWithSpace(oldStr: string, newStr: string, options?: unknown): Change[];
}
