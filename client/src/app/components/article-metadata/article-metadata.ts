import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ArticleSummary } from '../../models/article.model';

@Component({
  selector: 'app-article-metadata',
  imports: [DatePipe],
  templateUrl: './article-metadata.html',
  styleUrl: './article-metadata.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleMetadata {
  readonly article =
    input.required<Pick<ArticleSummary, 'author' | 'createdAt' | 'commentCount'>>();
}
