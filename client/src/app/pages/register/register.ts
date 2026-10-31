import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthField, AuthFieldErrors } from '../../models/auth.model';
import { Auth } from '../../services/auth/auth';
import { readAuthError } from '../../services/auth/auth-error';
import { characterLength, nonBlank, noControlCharacters } from '../../validators/auth.validator';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', [nonBlank, characterLength(1, 80), noControlCharacters]],
    email: [
      '',
      [
        Validators.required,
        Validators.email,
        Validators.maxLength(120),
        Validators.pattern(/^[\x21-\x7E]+$/),
      ],
    ],
    password: ['', [nonBlank, characterLength(15, 128)]],
  });
  protected readonly pending = signal(false);
  protected readonly message = signal('');
  private readonly serverFields = signal<AuthFieldErrors>({});

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.message.set('');
      this.serverFields.set({});
    });
  }

  protected fieldError(field: AuthField): string {
    const control = this.form.controls[field];
    const messages = {
      username: 'Use 1–80 characters without control characters.',
      email: 'Enter a valid ASCII email address (up to 120 characters).',
      password: 'Use 15–128 characters, not only whitespace.',
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
    this.form.controls.username.setValue(this.form.controls.username.value.trim());
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
      .register(this.form.getRawValue())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.pending.set(false)),
      )
      .subscribe({
        next: () => {
          this.form.controls.password.reset();
          void this.router.navigate(['/login'], { queryParams: { registered: '1' } });
        },
        error: (error: unknown) => {
          const result = readAuthError(error);
          this.message.set(result.message);
          this.serverFields.set(result.fields);
        },
      });
  }
}
