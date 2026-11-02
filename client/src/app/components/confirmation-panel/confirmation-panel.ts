import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Button } from '../button/button';

@Component({
  selector: 'app-confirmation-panel',
  imports: [Button],
  templateUrl: './confirmation-panel.html',
  styleUrl: './confirmation-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': 'compact()' },
})
export class ConfirmationPanel {
  readonly confirmationId = input.required<string>();
  readonly title = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly headingLevel = input<2 | 3>(2);
  readonly compact = input(false);
  readonly pending = input(false);
  readonly confirmDisabled = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  private readonly cancelButton = viewChild<unknown, ElementRef<HTMLButtonElement>>(
    'cancelButton',
    { read: ElementRef },
  );

  constructor() {
    afterNextRender(() => this.cancelButton()?.nativeElement.focus());
  }
}
