/** The `ui-field` whose label is `label`; with `translocoTesting()` the label is its key. */
export function field(root: HTMLElement, label: string): HTMLElement {
  const found = [ ...root.querySelectorAll<HTMLElement>('ui-field') ].find(
    element => element.querySelector('.label')?.textContent?.trim() === label
  );
  if (!found) {
    throw new Error(`No field labelled ${label}`);
  }
  return found;
}

/** The text control of the field labelled `label`. */
export function control(root: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = field(root, label).querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  if (!found) {
    throw new Error(`No text control in the field labelled ${label}`);
  }
  return found;
}

/** The error shown under the field labelled `label`, if any. */
export function errorOf(root: HTMLElement, label: string): string | undefined {
  return field(root, label).querySelector('.error')?.textContent?.trim();
}

/** Types `text` into a control as the user would, replacing its value, and leaves it. */
export function type(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  element.value = text;
  element.dispatchEvent(new Event('input'));
  element.dispatchEvent(new Event('change'));
  element.dispatchEvent(new Event('blur'));
}

/** The radio of a `ui-segmented-control` or other radio group labelled `label`. */
export function radio(root: HTMLElement, label: string): HTMLInputElement | undefined {
  return [ ...root.querySelectorAll<HTMLLabelElement>('label') ]
    .find(element => element.textContent?.trim() === label)
    ?.querySelector<HTMLInputElement>('input[type=radio]') ?? undefined;
}

/** Every radio label of the radio groups inside `root`, in order. */
export function radioLabels(root: HTMLElement): string[] {
  return [ ...root.querySelectorAll<HTMLInputElement>('input[type=radio]') ].map(
    input => input.closest('label')?.textContent?.trim() ?? ''
  );
}

/** Chooses the radio labelled `label`. */
export function choose(root: HTMLElement, label: string): void {
  const input = radio(root, label);
  if (!input) {
    throw new Error(`No radio labelled ${label}`);
  }
  input.click();
}

/** The button whose text is `text`. */
export function button(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [ ...root.querySelectorAll<HTMLButtonElement>('button') ].find(
    element => element.textContent?.trim() === text
  );
}

/** Opens the `ui-select` of the field labelled `label`; its options are then in the overlay. */
export function openSelect(root: HTMLElement, label: string): void {
  const trigger = field(root, label).querySelector<HTMLElement>('[role="combobox"]');
  if (!trigger) {
    throw new Error(`No select in the field labelled ${label}`);
  }
  trigger.focus();
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
}

/** The options of the open `ui-select`. */
export function selectOptions(): HTMLElement[] {
  return [ ...document.querySelectorAll<HTMLElement>('.cdk-overlay-container [role="option"]') ];
}

/** The text a `ui-select` of the field labelled `label` shows for its value. */
export function selectValue(root: HTMLElement, label: string): string | undefined {
  return field(root, label).querySelector('.value')?.textContent?.trim();
}
