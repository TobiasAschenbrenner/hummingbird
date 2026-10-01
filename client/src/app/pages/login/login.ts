import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthField, AuthFieldErrors } from '../../models/auth.model';
import { Auth } from '../../services/auth/auth';
import { readAuthError } from '../../services/auth/auth-error';
import { characterLength, nonBlank } from '../../validators/auth.validator';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: [
      '',
      [
        Validators.required,
        Validators.email,
        Validators.maxLength(120),
        Validators.pattern(/^[\x21-\x7E]+$/),
      ],
    ],
    password: ['', [nonBlank, characterLength(1, 128)]],
  });
  protected readonly pending = signal(false);
  protected readonly message = signal('');
  private readonly serverFields = signal<AuthFieldErrors>({});
  protected readonly accountCreated =
    inject(ActivatedRoute).snapshot.queryParamMap.get('registered') === '1';

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.message.set('');
      this.serverFields.set({});
    });
  }

  protected fieldError(field: Exclude<AuthField, 'username'>): string {
    const control = this.form.controls[field];
    const messages = {
      email: 'Enter a valid ASCII email address (up to 120 characters).',
      password: 'Enter your password (up to 128 characters).',
    };
    return (
      this.serverFields()[field] ?? (control.touched && control.invalid ? messages[field] : '')
    );
  }

  protected submit(): void {
    if (
      this.pending() ||
      this.auth.pending() ||
      this.auth.status() === 'checking' ||
      this.auth.user()
    )
      return;

    this.form.controls.email.setValue(this.form.controls.email.value.trim());
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.message.set('Please check the highlighted fields.');
      return;
    }
    this.message.set('');
    this.serverFields.set({});
    this.pending.set(true);
    this.auth
      .login(this.form.getRawValue())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => {
          this.form.controls.password.reset();
          void this.router.navigateByUrl('/');
        },
        error: (error: unknown) => {
          const result = readAuthError(error);
          this.message.set(result.message);
          this.serverFields.set(result.fields);
        },
      });
  }
}
