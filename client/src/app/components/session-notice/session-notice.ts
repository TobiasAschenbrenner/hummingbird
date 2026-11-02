import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../services/auth/auth';
import { Button, ButtonVariant } from '../button/button';

@Component({
  selector: 'app-session-notice',
  imports: [RouterLink, Button],
  templateUrl: './session-notice.html',
  styleUrl: './session-notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionNotice {
  readonly blocked = input(false);
  readonly showLogin = input(true);
  readonly variant = input<ButtonVariant>('primary');
  readonly checkRequested = output<void>();
  private readonly auth = inject(Auth);
  protected readonly disabled = computed(
    () => this.blocked() || this.auth.pending() || this.auth.status() === 'checking',
  );
}
