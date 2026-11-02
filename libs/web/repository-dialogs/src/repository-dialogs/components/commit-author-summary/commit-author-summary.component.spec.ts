import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CommitAuthorSummaryComponent } from './commit-author-summary.component';

const KEY = 'web-repository-dialogs.commitAuthor';

describe('CommitAuthorSummaryComponent', () => {
  let fixture: ComponentFixture<CommitAuthorSummaryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ CommitAuthorSummaryComponent, translocoTesting() ] })
      .compileComponents();
    fixture = TestBed.createComponent(CommitAuthorSummaryComponent);
    fixture.componentRef.setInput('author', { name: 'Ada', email: 'ada@example.com' });
    await settle(fixture);
  });

  it('shows the name and the email under the same labels as the form', () => {
    const rows = [ ...(fixture.nativeElement as HTMLElement).querySelectorAll('dt') ].map(row =>
      row.textContent?.trim()
    );
    const values = [ ...(fixture.nativeElement as HTMLElement).querySelectorAll('dd') ].map(row =>
      row.textContent?.trim()
    );

    expect(rows).toEqual([ `${KEY}.name`, `${KEY}.email` ]);
    expect(values).toEqual([ 'Ada', 'ada@example.com' ]);
  });
});
