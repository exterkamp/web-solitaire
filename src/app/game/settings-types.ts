// Which hand the phone is in. The piles you touch most move to that end of
// the board - the stock in Klondike, and nothing at all in FreeCell, which
// has no pile you press repeatedly.
//
// In its own file because both the settings service and the game modules need
// it, and neither should have to import the other to get at one word.
export type Handedness = 'left' | 'right';

// Whether a score prints as a number in the bar above the felt or as a stack
// of casino chips on the felt itself (see game/chip.ts). Same reasoning as
// Handedness above: the settings service and the scene both need the word.
export type ScoreDisplay = 'score' | 'chips';
