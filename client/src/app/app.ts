import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';

import { SiteHeader } from './components/site-header/site-header';
import { Auth } from './services/auth/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeader],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly auth = inject(Auth);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.auth.restoreSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
