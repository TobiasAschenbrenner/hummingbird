import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { ArticleField, ArticleFieldErrors } from '../../models/article.model';
import { ArticleOptions } from '../../models/catalog.model';
import { ArticleForm } from '../../validators/article-form.validator';

@Component({
  selector: 'app-article-fields',
  imports: [ReactiveFormsModule],
  templateUrl: './article-fields.html',
  styleUrl: './article-fields.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleFields implements OnInit {
  readonly form = input.required<ArticleForm>();
  readonly options = input.required<ArticleOptions>();
  readonly optionStatus = input.required<'idle' | 'loading' | 'ready' | 'error'>();
  readonly disabled = input(false);
  readonly readOnlySlug = input(false);
  readonly serverFields = input<ArticleFieldErrors>({});
  readonly reloadOptions = output<void>();
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.form()
      .events.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.changeDetector.markForCheck());
  }
  protected toggleTag(id: number, event: Event): void {
    if (
      this.disabled() ||
      this.optionStatus() !== 'ready' ||
      !(event.target instanceof HTMLInputElement)
    )
      return;
    const control = this.form().controls.tagIds;
    const selected = control.value.filter((value) => value !== id);
    if (event.target.checked && selected.length < 10) selected.push(id);
    control.setValue(selected);
    control.markAsDirty();
    control.markAsTouched();
  }

  protected hasUnavailableTags(): boolean {
    return (
      this.optionStatus() === 'ready' &&
      this.form().controls.tagIds.value.some(
        (id) => !this.options().tags.some((tag) => tag.id === id),
      )
    );
  }

  protected removeUnavailableTags(): void {
    if (this.disabled() || this.optionStatus() !== 'ready') return;
    const control = this.form().controls.tagIds;
    control.setValue(
      control.value.filter((id) => this.options().tags.some((tag) => tag.id === id)),
    );
    control.markAsDirty();
    control.markAsTouched();
  }

  protected fieldError(field: ArticleField): string {
    const control = this.form().controls[field];
    const messages: Record<ArticleField, string> = {
      title: 'Use 1–55 characters without control characters.',
      slug: 'Use 1–80 lowercase letters, digits and single hyphens.',
      description: 'Use 1–250 characters without control characters.',
      body: 'Use 1–20,000 characters. Tabs and line breaks are allowed.',
      categoryId: 'Select an existing category.',
      tagIds: 'Select up to 10 distinct existing tags.',
    };
    return (
      this.serverFields()[field] ?? (control.touched && control.invalid ? messages[field] : '')
    );
  }
}
