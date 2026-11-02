import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CatalogEntry } from '../../models/catalog.model';

@Component({
  selector: 'app-tag-list',
  templateUrl: './tag-list.html',
  styleUrl: './tag-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagList {
  readonly tags = input.required<readonly CatalogEntry[]>();
}
