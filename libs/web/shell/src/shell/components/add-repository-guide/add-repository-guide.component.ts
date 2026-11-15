import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, CollapsibleComponent, IconComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

let nextId = 0;

/**
 * The Add a repository section (DS-10 to DS-14): the full guide for a user
 * without repositories, otherwise a compact strip whose **How it works** shows
 * the same explanation and steps in place. The dashboard shows either form;
 * the repository management page shows the full guide without repositories
 * (RM-5).
 */
@Component({
  selector: 'shell-add-repository-guide',
  imports: [ TranslocoDirective, NgTemplateOutlet, RouterLink, ButtonComponent, CollapsibleComponent, IconComponent ],
  templateUrl: './add-repository-guide.component.html',
  styleUrl: './add-repository-guide.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-form]': 'form()' }
})
export class AddRepositoryGuideComponent {
  readonly form = input.required<'full' | 'compact'>();

  protected readonly expanded = signal(false);
  protected readonly detailsId = `shell-add-repository-guide-${nextId++}`;
}
