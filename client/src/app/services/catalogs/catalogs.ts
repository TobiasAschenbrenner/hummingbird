import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, timeout } from 'rxjs';

import { ArticleOptions } from '../../models/catalog.model';
import { readCatalogResponse } from './catalog-response';

@Injectable({ providedIn: 'root' })
export class CatalogsApi {
  private readonly http = inject(HttpClient);

  articleOptions(): Observable<ArticleOptions> {
    return forkJoin({
      categories: this.http
        .get<unknown>('/api/categories')
        .pipe(map((data) => readCatalogResponse(data, 'categories'))),
      tags: this.http
        .get<unknown>('/api/tags')
        .pipe(map((data) => readCatalogResponse(data, 'tags'))),
    }).pipe(timeout(10_000));
  }
}
