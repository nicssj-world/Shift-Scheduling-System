import type { CentralLabSection, JobIn, PersonStats, SectionWeights } from '@/lib/scheduler/types'

type JobCandidate = { userId: string; key: string; sectionWeights?: SectionWeights }
type JobMapping = [JobCandidate, JobIn]

/** Fixed Central Lab grouping for the first version of section preferences. */
export function centralLabSectionForJobCode(code: string): CentralLabSection | null {
  switch (String(code).toUpperCase()) {
    case 'CHEM':
    case 'SERO':
      return 'chem_sero'
    case 'HEMATO':
    case 'MICROSS':
      return 'hemato_micros'
    default:
      return null
  }
}

/**
 * Assign jobs to the people chosen for one slot so that, over time, everyone
 * cycles through all jobs evenly. Section-aware Jobs are assigned as a small
 * matching problem: first choose the people with the strongest preference for
 * that section, then permute the Jobs among them so each person's Jobs inside
 * the section stay balanced (Hemato/Micros therefore rotates instead of
 * always taking the first Job). A zero preference is deliberately a soft
 * priority, never an exclusion: if no preferred person remains, the fallback
 * person is still assigned.
 *
 * Deterministic: ties are broken by historical Job count, total Job count,
 * then by tiebreak key. Jobs without a section retain the legacy comparator.
 */
export function assignJobs(
  chosen: JobCandidate[],
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

  let index = 0
  while (index < sortedJobs.length && remaining.length > 0) {
    const job = sortedJobs[index]
    if (!job.section) {
      assignSingleJob(job, remaining, stats, result)
      index += 1
      continue
    }

    // Central Lab currently has two Jobs per section. Keep a contiguous
    // section together so the two Jobs can be balanced as a pair.
    const sectionJobs: JobIn[] = []
    while (index < sortedJobs.length && sortedJobs[index].section === job.section) {
      sectionJobs.push(sortedJobs[index])
      index += 1
    }
    const jobsToAssign = sectionJobs.slice(0, Math.min(sectionJobs.length, remaining.length))
    const people = [...remaining]
      .sort((a, b) => compareSectionPeople(a, b, job, stats))
      .slice(0, jobsToAssign.length)
    const mapping = bestSectionMapping(people, jobsToAssign, stats)
    for (const [person, assignedJob] of mapping) {
      result.set(person.userId, assignedJob.id)
      incrementJobCount(stats, person.userId, assignedJob.code)
    }
    const assignedIds = new Set(people.map((person) => person.userId))
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (assignedIds.has(remaining[i].userId)) remaining.splice(i, 1)
    }
  }

  // more people than jobs: extras have no job
  for (const person of remaining) result.set(person.userId, null)
  return result
}

function assignSingleJob(
  job: JobIn,
  remaining: JobCandidate[],
  stats: Record<string, PersonStats>,
  result: Map<string, string | null>,
) {
  remaining.sort((a, b) => compareLegacyPeople(a, b, job, stats))
  const person = remaining.shift()!
  result.set(person.userId, job.id)
  incrementJobCount(stats, person.userId, job.code)
}

/** Preference is the primary comparator for section membership. */
function compareSectionPeople(
  a: JobCandidate,
  b: JobCandidate,
  job: JobIn,
  stats: Record<string, PersonStats>,
) {
  const section = job.section!
  const aWeight = sectionWeight(a.sectionWeights, section)
  const bWeight = sectionWeight(b.sectionWeights, section)
  if (aWeight !== bWeight) return bWeight - aWeight

  // Preserve the old byJob → total Job count → deterministic key ordering
  // when section preferences tie.
  return compareLegacyPeople(a, b, job, stats)
}

function compareLegacyPeople(
  a: JobCandidate,
  b: JobCandidate,
  job: JobIn,
  stats: Record<string, PersonStats>,
) {
  const aStats = stats[a.userId]
  const bStats = stats[b.userId]
  const aCount = aStats?.byJob[job.code] ?? 0
  const bCount = bStats?.byJob[job.code] ?? 0
  if (aCount !== bCount) return aCount - bCount
  const aTotal = totalJobs(aStats)
  const bTotal = totalJobs(bStats)
  if (aTotal !== bTotal) return aTotal - bTotal
  return a.key.localeCompare(b.key)
}

/**
 * Find the deterministic Job permutation that leaves each selected person's
 * counts inside the section as even as possible. Central Lab has two Jobs per
 * section, but the bounded recursion also handles a future section with a few
 * more Jobs without changing the legacy path.
 */
function bestSectionMapping(
  people: JobCandidate[],
  jobs: JobIn[],
  stats: Record<string, PersonStats>,
): JobMapping[] {
  if (people.length === 0 || jobs.length === 0) return []
  if (people.length !== jobs.length || people.length > 6) {
    return jobs.map((job, index) => [people[index], job])
  }

  let best: JobMapping[] | null = null
  let bestScore: [number, number, string] | null = null
  const used = new Set<number>()
  const current: JobMapping[] = []

  function visit(depth: number) {
    if (depth === jobs.length) {
      const score = mappingScore(current, stats)
      if (!bestScore || compareMappingScore(score, bestScore) < 0) {
        bestScore = score
        best = [...current]
      }
      return
    }
    for (let personIndex = 0; personIndex < people.length; personIndex++) {
      if (used.has(personIndex)) continue
      used.add(personIndex)
      current.push([people[personIndex], jobs[depth]])
      visit(depth + 1)
      current.pop()
      used.delete(personIndex)
    }
  }

  visit(0)
  return best ?? jobs.map((job, index) => [people[index], job])
}

function mappingScore(
  mapping: JobMapping[],
  stats: Record<string, PersonStats>,
): [number, number, string] {
  let balancePenalty = 0
  let jobLoad = 0
  for (const [person, job] of mapping) {
    const personStats = stats[person.userId]
    const sectionJobs = mapping.map(([, candidate]) => candidate)
    const counts = sectionJobs.map((candidate) => (
      (personStats?.byJob[candidate.code] ?? 0) + (candidate.id === job.id ? 1 : 0)
    ))
    balancePenalty += Math.max(...counts) - Math.min(...counts)
    jobLoad += personStats?.byJob[job.code] ?? 0
  }
  const key = mapping.map(([person]) => person.key).join('|')
  return [balancePenalty, jobLoad, key]
}

function compareMappingScore(a: [number, number, string], b: [number, number, string]) {
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2])
}

function incrementJobCount(stats: Record<string, PersonStats>, userId: string, code: string) {
  const personStats = stats[userId]
  if (personStats) personStats.byJob[code] = (personStats.byJob[code] ?? 0) + 1
}

function sectionWeight(weights: SectionWeights | undefined, section: CentralLabSection) {
  const value = Number(weights?.[section])
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : 50
}

function totalJobs(stats: PersonStats | undefined) {
  if (!stats) return 0
  return Object.values(stats.byJob).reduce((sum, n) => sum + n, 0)
}
