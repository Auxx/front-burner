import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, IconComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

let nextId = 0;

/**
 * The Add a repository section (DS-10 to DS-14): the full guide for a user
 * without repositories, otherwise a compact strip whose **How it works** shows
 * the same explanation and steps in place.
 */
@Component({
  selector: 'dash-add-repository-guide',
  imports: [ TranslocoDirective, NgTemplateOutlet, RouterLink, ButtonComponent, IconComponent ],
  templateUrl: './add-repository-guide.component.html',
  styleUrl: './add-repository-guide.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-form]': 'form()' }
})
export class AddRepositoryGuideComponent {
  readonly form = input.required<'full' | 'compact'>();

  protected readonly expanded = signal(false);
  protected readonly detailsId = `dash-add-repository-guide-${nextId++}`;
}
