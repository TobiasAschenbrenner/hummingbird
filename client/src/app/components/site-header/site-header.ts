import { createSessionCheck } from '../../services/auth/session-check';
import { Button } from '../button/button';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { finalize } from 'rxjs';

import { Auth } from '../../services/auth/auth';
import { readAuthError } from '../../services/auth/auth-error';

@Component({
  selector: 'app-site-header',
  imports: [Button, RouterLink, RouterLinkActive],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeader {
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly checkSession = createSessionCheck(this.auth, this.destroyRef, () =>
    this.pending(),
  );
  protected readonly pending = signal(false);
  protected readonly errorMessage = signal('');

  protected logout(): void {
    if (this.pending() || this.auth.pending() || this.auth.status() === 'checking') return;
    this.errorMessage.set('');
    this.pending.set(true);
    this.auth
      .logout()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => {
          void this.router.navigateByUrl('/');
        },
        error: (error: unknown) => this.errorMessage.set(readAuthError(error).message),
      });
  }
}
