import { describe, expect, it } from 'vitest'
import { emptyStats } from '@/lib/scheduler/fairness'
import { assignJobs, centralLabSectionForJobCode } from '@/lib/scheduler/rotation'
import { FOUR_JOBS } from '@/lib/scheduler/fixtures'

function statsFor(...ids: string[]) {
  return Object.fromEntries(ids.map((id) => [id, emptyStats()]))
}

describe('Central Lab section-aware Job rotation', () => {
  it('maps the four Central Lab Jobs into their two sections', () => {
    expect(centralLabSectionForJobCode('CHEM')).toBe('chem_sero')
    expect(centralLabSectionForJobCode('SERO')).toBe('chem_sero')
    expect(centralLabSectionForJobCode('HEMATO')).toBe('hemato_micros')
    expect(centralLabSectionForJobCode('MICROSS')).toBe('hemato_micros')
    expect(centralLabSectionForJobCode('OTHER')).toBeNull()
  })

  it('places a 0/100 member in Hemato or Micros before Chem or Sero', () => {
    const stats = statsFor('u1', 'u2', 'u3', 'u4')
    const result = assignJobs([
      { userId: 'u1', key: 'u1', sectionWeights: { chem_sero: 0, hemato_micros: 100 } },
      { userId: 'u2', key: 'u2', sectionWeights: { chem_sero: 100, hemato_micros: 0 } },
      { userId: 'u3', key: 'u3', sectionWeights: { chem_sero: 50, hemato_micros: 50 } },
      { userId: 'u4', key: 'u4', sectionWeights: { chem_sero: 50, hemato_micros: 50 } },
    ], FOUR_JOBS, stats)

    expect(['job-hemato', 'job-micross']).toContain(result.get('u1'))
    expect(['job-chem', 'job-sero']).toContain(result.get('u2'))
  })

  it('keeps a 0% section eligible as a fallback', () => {
    const stats = statsFor('u1')
    const result = assignJobs([
      { userId: 'u1', key: 'u1', sectionWeights: { chem_sero: 0, hemato_micros: 100 } },
    ], [FOUR_JOBS[0]], stats)

    expect(result.get('u1')).toBe('job-chem')
  })

  it('splits a preferred Hemato/Micros section across both Jobs', () => {
    const stats = statsFor('u1', 'u2')
    const chosen = [
      { userId: 'u1', key: 'u1', sectionWeights: { chem_sero: 0, hemato_micros: 100 } },
      { userId: 'u2', key: 'u2', sectionWeights: { chem_sero: 50, hemato_micros: 50 } },
    ]
    const sectionJobs = [FOUR_JOBS[2], FOUR_JOBS[3]]
    const first = assignJobs(chosen, sectionJobs, stats)
    const second = assignJobs(chosen, sectionJobs, stats)

    expect(first.get('u1')).toBe('job-hemato')
    expect(second.get('u1')).toBe('job-micross')
    expect(stats.u1.byJob.HEMATO).toBe(1)
    expect(stats.u1.byJob.MICROSS).toBe(1)
  })

  it('retains legacy Job ordering when no section metadata is supplied', () => {
    const stats = statsFor('u1', 'u2')
    const result = assignJobs(
      [{ userId: 'u1', key: 'u1' }, { userId: 'u2', key: 'u2' }],
      [
        { id: 'job-a', code: 'A', sortOrder: 1 },
        { id: 'job-b', code: 'B', sortOrder: 2 },
      ],
      stats,
    )

    expect(result.get('u1')).toBe('job-a')
    expect(result.get('u2')).toBe('job-b')
  })
})
