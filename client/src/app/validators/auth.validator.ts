import { ValidatorFn, Validators } from '@angular/forms';

export const nonBlank: ValidatorFn = (control) =>
  typeof control.value === 'string' && control.value.trim() ? null : { nonBlank: true };

export function characterLength(minimum: number, maximum: number): ValidatorFn {
  return (control) => {
    if (typeof control.value !== 'string') return { characterLength: true };
    const length = [...control.value].length;
    return length >= minimum && length <= maximum ? null : { characterLength: true };
  };
}

export const noControlCharacters: ValidatorFn = (control) =>
  typeof control.value === 'string' && !/\p{Cc}/u.test(control.value)
    ? null
    : { controlCharacters: true };

export function emailValidators(): ValidatorFn[] {
  return [
    Validators.required,
    Validators.email,
    Validators.maxLength(120),
    Validators.pattern(/^[\x21-\x7E]+$/),
  ];
}
