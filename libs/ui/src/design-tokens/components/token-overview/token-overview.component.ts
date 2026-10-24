import { DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild
} from '@angular/core';

import { CONTRAST_PAIRS, ContrastPair } from '../../models/contrast-pairs.model';
import { contrastRatio, Rgb } from '../../utils/contrast/contrast.util';
import { collectTokenNames } from '../../utils/css-tokens/css-tokens.util';

export type TokenSection = 'primitives' | 'colours' | 'contrast' | 'typography' | 'layout';
export type Scheme = 'light' | 'dark';

interface TokenGroup {
  readonly title: string;
  readonly pattern: RegExp;
}

export interface ContrastResult {
  readonly pair: ContrastPair;
  readonly light?: number;
  readonly dark?: number;
  readonly status: 'pass' | 'fail' | 'missing';
}

const PRIMITIVE = /^(neutral|blue|green|amber|red|purple|teal)-(\d+)$/;

const COLOUR_GROUPS: readonly TokenGroup[] = [
  { title: 'Surfaces', pattern: /^surface-/ },
  { title: 'Selection', pattern: /^selected-/ },
  { title: 'Text', pattern: /^text-/ },
  { title: 'Icons', pattern: /^icon-(?!size$)/ },
  { title: 'Borders', pattern: /^border-(?!width$)/ },
  { title: 'Accent', pattern: /^accent/ },
  { title: 'Status', pattern: /^(info|success|warning|danger)-/ },
  { title: 'Git status', pattern: /^git-/ },
  { title: 'Diffs and conflicts', pattern: /^(diff|conflict)-/ },
  { title: 'Editor', pattern: /^editor-/ },
  { title: 'Syntax', pattern: /^syntax-/ },
  { title: 'Elevation and scrollbars', pattern: /^(shadow-color|scrollbar-)/ }
];

const LAYOUT_GROUPS: readonly TokenGroup[] = [
  { title: 'Space', pattern: /^space-/ },
  { title: 'Radius', pattern: /^radius-/ },
  { title: 'Elevation', pattern: /^shadow-(?!color$)/ },
  { title: 'Density', pattern: /^(control-|row-|icon-size$)/ },
  { title: 'Islands, borders and focus', pattern: /^(island-|border-width$|focus-)/ },
  { title: 'Motion', pattern: /^(duration|easing)-/ }
];

/**
 * The design token reference shown in Storybook (A-10.40). Lists every `--ui-*`
 * token found in the loaded style sheets, both colour schemes side by side, and
 * the measured contrast of every pair in CONTRAST_PAIRS (A-10.10).
 *
 * Only for Storybook; not exported from the library.
 */
@Component({
  selector: 'ui-token-overview',
  imports: [ DecimalPipe ],
  templateUrl: './token-overview.component.html',
  styleUrl: './token-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TokenOverviewComponent {
  readonly section = input.required<TokenSection>();

  protected readonly schemes: readonly Scheme[] = [ 'light', 'dark' ];

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly probe = viewChild.required<ElementRef<HTMLElement>>('probe');

  private readonly tokens = signal<string[]>([]);
  /** Computed values: per scheme for colours, from the root for the rest. */
  private readonly values = signal<
    { light: Map<string, string>; dark: Map<string, string>; root: Map<string, string>; }
  >({
    light: new Map(),
    dark: new Map(),
    root: new Map()
  });

  protected readonly contrast = signal<ContrastResult[]>([]);

  protected readonly primitives = computed(() => {
    const hues = new Map<string, string[]>();
    for (const token of this.tokens()) {
      const match = PRIMITIVE.exec(token);
      if (match) {
        hues.set(match[1], [ ...(hues.get(match[1]) ?? []), token ]);
      }
    }
    return [ ...hues ].map(([ hue, tokens ]) => ({ hue, tokens }));
  });

  protected readonly colourGroups = computed(() => this.group(COLOUR_GROUPS));
  protected readonly layoutGroups = computed(() => this.group(LAYOUT_GROUPS));
  protected readonly fontSizes = computed(() => this.tokens().filter(token => token.startsWith('font-size-')));
  protected readonly typeTokens = computed(() =>
    this.tokens().filter(token => /^(font-family|font-weight|line-height)-/.test(token))
  );

  protected readonly failures = computed(() => this.contrast().filter(result => result.status !== 'pass').length);

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.tokens.set(collectTokenNames(Array.from(document.styleSheets)));
      this.refresh();

      // Theme and density switches in the Storybook toolbar change these.
      const observer = new MutationObserver(() => this.refresh());
      observer.observe(document.documentElement, { attributeFilter: [ 'data-theme', 'data-density' ] });
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected value(token: string, scope: Scheme | 'root' = 'root'): string {
    return this.values()[scope].get(token) ?? '';
  }

  protected ref(token: string): string {
    return `var(--ui-${token})`;
  }

  /** A CSS `background` that stacks the layers, the first at the bottom. */
  protected background(layers: readonly string[]): string {
    const [ bottom, ...overlays ] = layers;
    const images = overlays.reverse().map(layer => `linear-gradient(${this.ref(layer)}, ${this.ref(layer)})`);
    return [ ...images, this.ref(bottom) ].join(', ');
  }

  private group(groups: readonly TokenGroup[]) {
    const tokens = this.tokens();
    return groups
      .map(({ title, pattern }) => ({ title, tokens: tokens.filter(token => pattern.test(token)) }))
      .filter(group => group.tokens.length > 0);
  }

  private refresh(): void {
    const tokens = this.tokens();
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      return new Map(tokens.map(token => [ token, style.getPropertyValue(`--ui-${token}`).trim() ]));
    };

    this.values.set({
      light: read(this.scope('light')),
      dark: read(this.scope('dark')),
      root: read(document.documentElement)
    });
    if (this.section() === 'contrast') {
      this.contrast.set(this.measure());
    }
  }

  private scope(scheme: Scheme): HTMLElement {
    return this.probe().nativeElement.querySelector(`[data-theme="${scheme}"]`) as HTMLElement;
  }

  /** Paints each pair on a 1×1 canvas and reads the pixels back as sRGB. */
  private measure(): ContrastResult[] {
    const canvas = this.host.nativeElement.ownerDocument.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return [];
    }

    const pixel = (): Rgb => {
      const [ r, g, b ] = context.getImageData(0, 0, 1, 1).data;
      return [ r, g, b ];
    };

    const ratio = (pair: ContrastPair, scheme: Scheme): number | undefined => {
      const scope = this.scope(scheme);
      const colours = [ ...pair.background, pair.foreground ].map(token => this.colour(scope, token));
      if (colours.some(colour => colour === undefined)) {
        return undefined;
      }

      const foreground = colours.pop() as string;
      context.clearRect(0, 0, 1, 1);
      for (const colour of colours as string[]) {
        context.fillStyle = colour;
        context.fillRect(0, 0, 1, 1);
      }
      const background = pixel();
      context.fillStyle = foreground;
      context.fillRect(0, 0, 1, 1);
      return contrastRatio(pixel(), background);
    };

    return CONTRAST_PAIRS.map(pair => {
      const light = ratio(pair, 'light');
      const dark = ratio(pair, 'dark');
      const status = light === undefined || dark === undefined
        ? 'missing'
        : Math.min(light, dark) >= pair.minimum
        ? 'pass'
        : 'fail';
      return { pair, light, dark, status };
    });
  }

  /** The computed colour of a token in a scope, or undefined if it is not defined. */
  private colour(scope: HTMLElement, token: string): string | undefined {
    if (!getComputedStyle(scope).getPropertyValue(`--ui-${token}`).trim()) {
      return undefined;
    }
    const swatch = scope.ownerDocument.createElement('span');
    swatch.style.backgroundColor = this.ref(token);
    scope.append(swatch);
    const colour = getComputedStyle(swatch).backgroundColor;
    swatch.remove();
    return colour;
  }
}
