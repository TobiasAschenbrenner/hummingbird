import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { HealthApi } from '../../services/health/health';

type ConnectionStatus = 'checking' | 'connected' | 'unavailable';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home implements OnInit {
  private readonly healthApi = inject(HealthApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly status = signal<ConnectionStatus>('checking');

  ngOnInit(): void {
    this.checkStatus();
  }

  protected checkStatus(): void {
    this.status.set('checking');
    this.healthApi
      .getStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.status.set('connected'),
        error: () => this.status.set('unavailable'),
      });
  }
}
