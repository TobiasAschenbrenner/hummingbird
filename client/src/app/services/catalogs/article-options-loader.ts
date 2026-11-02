import { DestroyRef, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ArticleOptions } from '../../models/catalog.model';
import { LoadStatus } from '../../models/load-status.model';
import { CatalogsApi } from './catalogs';

export function createArticleOptionsLoader(
  api: CatalogsApi,
  destroyRef: DestroyRef,
  onLoaded: () => void,
) {
  const options = signal<ArticleOptions>({ categories: [], tags: [] });
  const status = signal<LoadStatus>('idle');

  function load(): void {
    if (status() === 'loading') return;
    status.set('loading');
    api
      .articleOptions()
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (loaded) => {
          options.set(loaded);
          onLoaded();
          status.set('ready');
        },
        error: () => status.set('error'),
      });
  }

  return { options: options.asReadonly(), status: status.asReadonly(), load };
}
