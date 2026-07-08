import type { JobIn, PersonStats } from '@/lib/scheduler/types'

/**
 * Assign jobs to the people chosen for one slot so that, over time, everyone
 * cycles through all jobs evenly. For each job (in sort order) pick the
 * still-unassigned person with the lowest historical count for that job.
 * Deterministic: ties broken by total job count, then by tiebreak key.
 */
export function assignJobs(
  chosen: { userId: string; key: string }[],
  jobs: JobIn[],
  stats: Record<string, PersonStats>,
): Map<string, string | null> {
  const result = new Map<string, string | null>()
  if (jobs.length === 0) {
    for (const person of chosen) result.set(person.userId, null)
    return result
  }

  const sortedJobs = [...jobs].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
  const remaining = [...chosen]

  for (const job of sortedJobs) {
    if (remaining.length === 0) break
    remaining.sort((a, b) => {
      const aStats = stats[a.userId]
      const bStats = stats[b.userId]
      const aCount = aStats?.byJob[job.code] ?? 0
      const bCount = bStats?.byJob[job.code] ?? 0
      if (aCount !== bCount) return aCount - bCount
      const aTotal = totalJobs(aStats)
      const bTotal = totalJobs(bStats)
      if (aTotal !== bTotal) return aTotal - bTotal
      return a.key.localeCompare(b.key)
    })
    const person = remaining.shift()!
    result.set(person.userId, job.id)
    const personStats = stats[person.userId]
    if (personStats) {
      personStats.byJob[job.code] = (personStats.byJob[job.code] ?? 0) + 1
    }
  }

  // more people than jobs: extras have no job
  for (const person of remaining) result.set(person.userId, null)
  return result
}

function totalJobs(stats: PersonStats | undefined) {
  if (!stats) return 0
  return Object.values(stats.byJob).reduce((sum, n) => sum + n, 0)
}
