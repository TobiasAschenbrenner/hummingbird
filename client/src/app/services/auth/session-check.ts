import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth } from './auth';

export function createSessionCheck(
  auth: Auth,
  destroyRef: DestroyRef,
  blocked: () => boolean,
): () => void {
  return () => {
    if (blocked() || auth.pending() || auth.status() === 'checking') return;
    auth.restoreSession().pipe(takeUntilDestroyed(destroyRef)).subscribe();
  };
}
