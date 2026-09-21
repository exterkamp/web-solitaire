// How long something took, written the way a clock writes it.
//
// Shared between the board's running timer and the record book, which is the
// entire reason it is not a method on either: the two would have drifted into
// "4:07" and "4m 7s" within a week, and a personal best that reads
// differently on the two screens it appears on is a personal best somebody
// has to check.
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// A record that has not been set yet.
//
// Zero reads as a dash rather than as an achievement: no best time and a best
// time of zero seconds are the same thing, and only one of them is honest.
// The running clock does not go through here - a game that has just started
// really has taken no time, and "—" where the timer goes looks broken.
export function formatBestTime(seconds: number): string {
  return seconds ? formatDuration(seconds) : '—';
}

export function formatBest(value: number): string {
  return value ? value.toLocaleString() : '—';
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
