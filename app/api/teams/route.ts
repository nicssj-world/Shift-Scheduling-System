import { requireActor } from '@/lib/server/auth'
import { getJobs, getRequirements, getShiftTypes, getTeamMembers, getTeams } from '@/lib/server/data'
import { respond } from '@/lib/server/route'

export async function GET() {
  return respond(async () => {
    await requireActor()
    const teams = await getTeams()
    const shiftTypes = await getShiftTypes()
    const requirements = await getRequirements()
    const bundles = await Promise.all(
      teams.map(async (team) => ({
        ...team,
        members: await getTeamMembers(team.id, false),
        jobs: await getJobs(team.id),
      })),
    )
    return { teams: bundles, shiftTypes, requirements }
  })
}
