import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, timeout } from 'rxjs';

import { ApiHealth } from '../../models/api-health.model';

@Injectable({ providedIn: 'root' })
export class HealthApi {
  private readonly http = inject(HttpClient);

  getStatus(): Observable<ApiHealth> {
    return this.http.get<ApiHealth>('/api/health').pipe(
      timeout(5000),
      map((response) => {
        if (response?.status !== 'ok') {
          throw new Error('Unexpected API health response.');
        }
        return response;
      }),
    );
  }
}
