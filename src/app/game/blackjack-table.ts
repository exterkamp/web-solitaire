import { CARD_HEIGHT, CARD_WIDTH } from './config';
import { Card } from './deck';
import { PileRef } from './piles';
import { Handedness } from './settings-types';
import { GameView, PileCards, PileSlot, TableGame, TableMoveResult } from './table-game';
import { BlackjackState, CUT, act, actions, deal, hasWon, isDeadEnd, note, pileRefs, status } from './blackjack';

// Narrow, for bigger cards: there are only ever a handful on the table, and
// the board is fitted to the screen's width.
const WIDTH = 360;

// The dealer across the top, below the lettering; your hand below that.
const DEALER_Y = 230;
const HAND_Y = 420;
// A split hand sits under the first, which stays where it was: hands are
// spread across the table, so side by side they would run into each other.
const HAND_ROWS = [HAND_Y, HAND_Y + CARD_HEIGHT + 30];
// What a card shows of the one under it, spread across: its whole corner,
// rank and suit side by side, and a little clear felt-white past them.
const SPREAD = Math.round(CARD_WIDTH * 0.6);

// The shoe beside the dealer, where it is on a real table, and the discard
// tray on the other side - at the two ends of the dealer's row, clear of a
// hand of six spread between them.
const SHOE = { x: WIDTH - 45, y: DEALER_Y };
const TRAY = { x: 45, y: DEALER_Y };

// Blackjack, as the board sees it.
//
// No card on this table is ever picked up. Every move is a decision, made
// with the game's own buttons under the board - bet, hit, stand, double,
// split - and the cards come out of the shoe to show what it was.
export function blackjackTable(bankroll: () => number): TableGame<BlackjackState> {
  return {
    id: 'blackjack',
    label: 'Blackjack',
    width: WIDTH,
    columns: 5,
    drops: false,
    // A move is a button. How many of them a shoe took says nothing.
    showsMoves: false,
    forPoints: { unit: 'chips' },
    // Every hit turns a card nobody has seen. An undo would be a look at
    // the next one.
    undoable: false,
    actAnchor: pileRefs.hand(0),

    slots(_handedness: Handedness): PileSlot[] {
      return [
        { ref: pileRefs.stock, column: 0, row: 'top', ...SHOE, recycle: false },
        { ref: pileRefs.waste, column: 0, row: 'top', ...TRAY },
        { ref: pileRefs.dealer, column: 0, row: 'tableau', x: WIDTH / 2, y: DEALER_Y, printed: true, target: false },
        ...HAND_ROWS.map((y, i) => ({
          ref: pileRefs.hand(i),
          column: 0,
          row: 'tableau' as const,
          x: WIDTH / 2,
          y,
          // The second only exists once a pair has been split.
          printed: i === 0,
          target: false,
        })),
      ];
    },

    // Spread across, each card's index showing, the way a dealer lays a hand
    // out on the felt.
    fanStep(ref: PileRef, _cards: readonly Card[], index: number): number {
      return ref.kind === 'tableau' && index > 0 ? SPREAD : 0;
    },
    fansUp: () => false,
    fansAcross: (ref: PileRef) => ref.kind === 'tableau',

    deal: (random) => deal(bankroll(), random),
    dealsFaceDown: false,

    piles(state: BlackjackState): PileCards[] {
      return [
        { ref: pileRefs.stock, cards: state.stock },
        { ref: pileRefs.waste, cards: state.waste },
        { ref: pileRefs.dealer, cards: state.dealer },
        ...HAND_ROWS.map((_, i) => ({ ref: pileRefs.hand(i), cards: state.hands[i]?.cards ?? [] })),
      ];
    },

    moveCount: (state) => state.moves,
    // Nothing is picked up, nothing is put down, and the deck is not turned
    // by pressing it: every move goes through act.
    liftable: () => undefined,
    canDrop: () => false,
    apply: () => undefined,
    act: (state, action): TableMoveResult<BlackjackState> | undefined => act(state, action),
    autoTarget: () => undefined,
    autoFinishMove: () => undefined,
    canAutoFinish: () => false,
    hasWon,
    isDeadEnd,

    view(state: BlackjackState): GameView {
      return {
        score: state.bank,
        // Cards left before the cut card ends the shoe.
        deck: Math.max(0, state.stock.length - CUT),
        status: status(state),
        note: note(state),
        actions: actions(state),
      };
    },

    dealOrigin: () => SHOE,
  };
}
