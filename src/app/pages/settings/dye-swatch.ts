import { Component, DestroyRef, inject, input, output } from '@angular/core';
import { ColorPickerDirective } from 'ngx-color-picker';

// One colour, as a card you tap.
//
// Every colour on this page goes through here - the back colour and the
// seven a custom deck is made of - so they are one control rather than two
// that happen to look alike, and the library's configuration is written
// down once.
//
// The button is in its own `cpIgnoredElements` on purpose. Left to itself
// the library acts on the tap, and because a button is the focused element
// by then it reads every tap as "open me" - so a second tap on an open
// picker reopens it rather than shutting it. Ignored, `cpToggle` is the only
// thing that opens or closes anything, and `open` is the page's to decide.
@Component({
  selector: 'app-dye-swatch',
  imports: [ColorPickerDirective],
  styleUrl: './dye-swatch.scss',
  template: `
    <button
      #swatch
      type="button"
      class="dye"
      [class.dye--open]="open()"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label() + ', ' + color()"
      [colorPicker]="color()"
      [cpToggle]="open()"
      [cpIgnoredElements]="[swatch]"
      [cpPresetColors]="presets()"
      [cpUseRootViewContainer]="true"
      [cpAlphaChannel]="'disabled'"
      [cpOutputFormat]="'hex'"
      cpPosition="auto"
      cpPresetLabel="This game's colours"
      (click)="toggled.emit()"
      (cpToggleChange)="dialog($event)"
      (colorPickerChange)="picked.emit($event)"
    >
      <span class="dye__chip" [style.background-color]="color()"></span>
      <span class="dye__text">
        <span class="dye__label">{{ label() }}</span>
        @if (hint()) {
          <span class="dye__hint">{{ hint() }}</span>
        }
      </span>
    </button>
  `,
})
export class DyeSwatch {
  readonly label = input.required<string>();
  readonly hint = input('');
  readonly color = input.required<string>();
  readonly presets = input<string[]>([]);

  /** Whose picker is showing is the page's business, not this button's. */
  readonly open = input(false);

  readonly toggled = output<void>();
  readonly closed = output<void>();
  readonly picked = output<string>();

  private gone = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
    });
  }

  /**
   * The dialog closing by itself - a click outside it, or Escape.
   *
   * The page has to hear about that or its idea of which swatch is open goes
   * stale, and the next tap on this one would be a no-op. Not once the button
   * has gone, though: turning the custom deck off destroys the swatches, and
   * a dialog torn down with them reports itself closed on the way out, to an
   * output nobody owns any more.
   */
  protected dialog(open: boolean): void {
    if (!open && !this.gone) this.closed.emit();
  }
}
