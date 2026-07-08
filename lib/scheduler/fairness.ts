import type { PersonStats, SchedulerWeights } from '@/lib/scheduler/types'
import type { DayClass } from '@/lib/types'

export function emptyStats(): PersonStats {
  return { total: 0, byType: {}, weekendHoliday: 0, byJob: {} }
}

/**
 * Lower is better. Deterministic — no randomness anywhere.
 * `carryTotal` is the person's lifetime shift count on this team from all
 * prior months (see CarryIn.totalCounts) — folding it into the total-shifts
 * term is what makes the "extra" shift rotate through everyone over time
 * instead of sticking with whoever drew it first. `stats.total` itself stays
 * scoped to the current run so callers can still report "shifts this month".
 */
export function fairnessScore(
  stats: PersonStats,
  code: string,
  dayClass: DayClass,
  consecutiveBefore: number,
  weights: SchedulerWeights,
  carryTotal = 0,
): number {
  return (
    weights.total * (stats.total + carryTotal) +
    weights.type * (stats.byType[code] ?? 0) +
    (dayClass !== 'weekday' ? weights.weekend * stats.weekendHoliday : 0) +
    weights.consecutive * consecutiveBefore
  )
}

export type PairCounts = Record<string, Record<string, number>>

/** Penalty added for a candidate who has already shared many shifts with
 *  people already picked for this same slot instance — spreads out who
 *  ends up working together instead of letting a few pairs always cluster. */
export function pairingPenalty(candidateId: string, alreadyChosen: string[], pairCounts: PairCounts, weight: number): number {
  if (weight === 0) return 0
  let total = 0
  const counts = pairCounts[candidateId]
  if (!counts) return 0
  for (const other of alreadyChosen) total += counts[other] ?? 0
  return weight * total
}

/** Record that everyone in `group` shared a shift together. */
export function recordPairs(group: string[], pairCounts: PairCounts) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const [a, b] = [group[i], group[j]]
      ;(pairCounts[a] ??= {})[b] = (pairCounts[a][b] ?? 0) + 1
      ;(pairCounts[b] ??= {})[a] = (pairCounts[b][a] ?? 0) + 1
    }
  }
}

/** Count consecutive days with work immediately before `date`. */
export function consecutiveWorkDaysBefore(workDates: Set<string>, date: string): number {
  let count = 0
  let cursor = date
  while (count < 14) {
    const prev = shiftDate(cursor, -1)
    if (!workDates.has(prev)) break
    count += 1
    cursor = prev
  }
  return count
}

/**
 * Deterministic pseudo-random tiebreak, varied per (date, slot). A static
 * tiebreak (e.g. plain key comparison) always resolves ties the same
 * direction, so whoever has the "losing" key is systematically excluded —
 * and therefore clustered together with the other systematic losers — every
 * time scores tie. Hashing in the date/slot spreads out who wins ties across
 * the whole month while staying fully deterministic (same input → same
 * output, no Math.random anywhere).
 */
export function tieBreakHash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
