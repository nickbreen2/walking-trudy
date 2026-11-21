// Fair random tagging: a shuffled "bag" of walkers. Each person is picked once
// before anyone repeats, and nobody is picked twice in a row across refills.

export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface Pick {
  pick: string | null;
  bag: string[];
}

/**
 * Take the next walker from the bag.
 * @param avoid people not to pick (e.g. today's assignee when choosing a backup,
 *              or yesterday's walker when refilling).
 */
export function pickFromBag(
  bag: string[],
  walkers: string[],
  random: () => number,
  avoid: string[] = [],
): Pick {
  if (walkers.length === 0) return { pick: null, bag: [] };

  // Drop anyone removed from config since the bag was made.
  let current = bag.filter((w) => walkers.includes(w));
  const usable = (list: string[]) => list.filter((w) => !avoid.includes(w));

  if (usable(current).length === 0) {
    const refill = shuffle(walkers, random);
    // Put avoided people at the back of the fresh bag.
    current = [...usable(refill), ...refill.filter((w) => avoid.includes(w))];
  }

  const choice = usable(current)[0] ?? current[0] ?? null;
  if (choice === null) return { pick: null, bag: current };
  return { pick: choice, bag: current.filter((w) => w !== choice) };
}
