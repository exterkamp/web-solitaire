import { Component, booleanAttribute, input, output } from '@angular/core';

// A labelled row of round chips, one of which is chosen.
//
// This is how a setting with a handful of answers is asked here: how many
// cards a draw turns, which hand the phone is in, which deck to look at.
// Taken from Nertz, where it exists because the same row had been written out
// seven times across three screens and the copies had drifted.
//
// Generic over what is being chosen so a caller can pick numbers or words,
// and `display` exists because the value stored is not always the word shown:
// the draw chips hold 1 and 3 and read "One" and "Three".
//
// Emits rather than writes, so it does not have to know whether the thing it
// is changing is a setting, a filter or a game about to be dealt.
@Component({
  host: {
    // On the host rather than a wrapper div, so the component *is* the row and
    // a page can space it like any other element in its column.
    '[class.chip-select--off]': 'disabled()',
  },
  imports: [],
  selector: 'app-chip-select',
  styleUrl: './chip-select.scss',
  templateUrl: './chip-select.html',
})
export class ChipSelect<T extends string | number> {
  readonly label = input.required<string>();
  readonly options = input.required<readonly T[]>();
  // What is chosen now. Not required: a setting can legitimately have no
  // answer yet, and nothing should look chosen when it does not.
  readonly value = input<T | null>(null);
  // Greys the row and refuses the presses, for a choice that is real but not
  // available yet.
  //
  // `booleanAttribute` on both of these so they can be written bare, the way
  // `disabled` is on a real button - `<app-chip-select wide>` rather than
  // `[wide]="true"`. Without it a bare attribute is the empty string, which
  // is a template type error rather than a quietly wrong value.
  readonly disabled = input(false, { transform: booleanAttribute });
  // Chips wide enough for a word rather than a digit.
  readonly wide = input(false, { transform: booleanAttribute });
  // How to write an option, when it is not simply itself.
  readonly display = input<(option: T) => string>();

  readonly picked = output<T>();

  protected text(option: T): string {
    return this.display()?.(option) ?? String(option);
  }
}
