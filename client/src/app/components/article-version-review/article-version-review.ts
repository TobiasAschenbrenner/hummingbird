import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ArticleDetail } from '../../models/article.model';
import { LoadStatus } from '../../models/load-status.model';
import { Button } from '../button/button';

@Component({
  selector: 'app-article-version-review',
  imports: [Button],
  templateUrl: './article-version-review.html',
  styleUrl: './article-version-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleVersionReview {
  readonly article = input<ArticleDetail | null>(null);
  readonly status = input.required<LoadStatus>();
  readonly disabled = input(false);
  readonly loadRequested = output<void>();
  readonly savedVersionChosen = output<void>();
  readonly draftKept = output<void>();
}
