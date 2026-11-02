import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'text' | 'header';

@Component({
  selector: 'button[appButton], a[appButton]',
  template: '<ng-content />',
  styleUrl: './button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'button', '[attr.data-variant]': 'variant()' },
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
}
