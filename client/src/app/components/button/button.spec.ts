import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Button } from './button';

@Component({
  imports: [Button],
  template: `
    <form (submit)="$event.preventDefault(); submissions = submissions + 1">
      <button appButton type="submit" [disabled]="disabled()">Publish article</button>
      <button appButton variant="secondary" type="button">Cancel</button>
    </form>
    <a appButton variant="secondary" href="/articles">Read articles</a>
  `,
})
class ButtonHost {
  readonly disabled = signal(false);
  submissions = 0;
}

describe('Button', () => {
  it('preserves native form submission, cancellation and disabled behavior', async () => {
    const fixture = TestBed.createComponent(ButtonHost);
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    const [submit, cancel] = element.querySelectorAll<HTMLButtonElement>('button');
    expect(submit.textContent).toBe('Publish article');
    cancel.click();
    expect(fixture.componentInstance.submissions).toBe(0);
    submit.click();
    expect(fixture.componentInstance.submissions).toBe(1);
    fixture.componentInstance.disabled.set(true);
    await fixture.whenStable();
    submit.click();
    expect(fixture.componentInstance.submissions).toBe(1);
  });

  it('keeps navigation actions as native links', async () => {
    const fixture = TestBed.createComponent(ButtonHost);
    await fixture.whenStable();
    const link = fixture.nativeElement.querySelector('a');
    expect(link.getAttribute('href')).toBe('/articles');
    expect(link.textContent).toBe('Read articles');
    expect(link.getAttribute('role')).toBeNull();
  });
});
