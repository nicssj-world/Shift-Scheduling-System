const TITLE_PREFIXES = [
  'นายแพทย์', 'แพทย์หญิง', 'นางสาว', 'น.ส.', 'นาย', 'นาง', 'ดร.', 'ทนพ.', 'ทนพญ.',
]

/** Strip Thai title prefix and split into [firstName, lastName]. */
export function splitThaiName(fullName: string): { first: string; last: string } {
  let name = fullName.trim()
  for (const prefix of TITLE_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length).trim()
      break
    }
  }
  const parts = name.split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

/** Thai combining marks (vowels above/below, tone marks, sara am). */
const THAI_COMBINING = /[ัำ-ฺ็-๎]/

/**
 * First `len` code points of the surname, extended so we never cut right
 * before a combining mark (พูลขำ, len 3 → พูล; สุธีรา, len 3 → สุธี).
 */
function surnamePrefix(chars: string[], len: number): string {
  let end = Math.min(len, chars.length)
  while (end < chars.length && THAI_COMBINING.test(chars[end])) end += 1
  return chars.slice(0, end).join('')
}

export type NamedPerson = { userId: string; fullName: string; displayLabel?: string | null }

/**
 * Build display names: first name only; duplicates get (leading graphemes of
 * surname) extended until unique — นฤมล งามวชิรพร / นฤมล พูลขำ →
 * นฤมล(งาม), นฤมล(พูล). An explicit displayLabel always wins.
 */
export function buildDisplayNames(people: NamedPerson[]): Map<string, string> {
  const result = new Map<string, string>()
  const byFirst = new Map<string, NamedPerson[]>()

  for (const person of people) {
    if (person.displayLabel) {
      result.set(person.userId, person.displayLabel)
      continue
    }
    const { first } = splitThaiName(person.fullName)
    const list = byFirst.get(first) ?? []
    list.push(person)
    byFirst.set(first, list)
  }

  for (const [first, group] of byFirst) {
    if (group.length === 1) {
      result.set(group[0].userId, first || group[0].fullName)
      continue
    }
    // Duplicate first names: extend surname prefix until all are unique.
    const lasts = group.map((p) => Array.from(splitThaiName(p.fullName).last))
    let len = 3
    const maxLen = Math.max(...lasts.map((g) => g.length), 1)
    while (len < maxLen) {
      const prefixes = lasts.map((g) => surnamePrefix(g, len))
      if (new Set(prefixes).size === prefixes.length) break
      len += 1
    }
    group.forEach((person, i) => {
      const prefix = surnamePrefix(lasts[i], len)
      result.set(person.userId, prefix ? `${first}(${prefix})` : first)
    })
  }

  return result
}
