import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { articleListParams } from '../../validators/article-list.validator';
import { ArticleFilters, ArticleSummary } from '../../models/article.model';

@Component({
  selector: 'app-article-card',
  imports: [DatePipe, RouterLink],
  templateUrl: './article-card.html',
  styleUrl: './article-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleCard {
  readonly article = input.required<ArticleSummary>();
  readonly page = input(1);
  readonly filters = input<ArticleFilters>({});
  protected readonly listQuery = computed(() =>
    articleListParams({ ...this.filters(), page: this.page() }),
  );
}
