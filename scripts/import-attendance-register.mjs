#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_DAILY = 'C:/Users/nicss/Downloads/วันลากลุ่มงานเทคนิคการแพทย์ ปี 2569.xlsx'
const DEFAULT_SUMMARY = 'C:/Users/nicss/Downloads/สรุปวันลากลุ่มงานเทคนิคการแพทย์ ปี 2569.xlsx'
const MONTH_SHEETS = [
  ['ตค68', 2025, 10], ['พย68', 2025, 11], ['ธค68', 2025, 12],
  ['มค69', 2026, 1], ['กพ69', 2026, 2], ['มีค69', 2026, 3],
  ['เมย.69', 2026, 4], ['พค69', 2026, 5], ['มิย69', 2026, 6],
  ['กค69', 2026, 7], ['สค69', 2026, 8], ['กย69', 2026, 9],
]
const EXCEL_CODE_MAP = {
  'พ': 'vacation', 'ป': 'sick', 'ป/2': 'sick_half',
  'ก': 'personal', 'ก/2': 'personal_half', 'ข': 'absent',
  'ส': 'late', 'บ': 'early', 'พ/2': 'vacation_half', 'ค': 'maternity', 'ค.': 'maternity',
}
const FISCAL_YEAR = 2026
const FUZZY_GUESS_THRESHOLD = 0.82
const FUZZY_GUESS_MARGIN = 0.05
const FUZZY_SUGGESTION_THRESHOLD = 0.4

function parseArgs(argv) {
  const args = {
    file: DEFAULT_DAILY, summary: DEFAULT_SUMMARY, mode: 'dry-run', actor: '', report: '', acceptGuesses: false,
    sourceOfTruth: 'daily', discardUnmatched: true,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--commit') args.mode = 'commit'
    else if (item === '--dry-run') args.mode = 'dry-run'
    else if (item === '--file') args.file = argv[++i] ?? ''
    else if (item === '--summary') args.summary = argv[++i] ?? ''
    else if (item === '--actor') args.actor = argv[++i] ?? ''
    else if (item === '--report') args.report = argv[++i] ?? ''
    else if (item === '--accept-guesses') args.acceptGuesses = true
    else if (item === '--source-of-truth') args.sourceOfTruth = argv[++i] ?? ''
    else if (item === '--keep-unmatched') args.discardUnmatched = false
    else if (item === '--help' || item === '-h') {
      console.log('Usage: node scripts/import-attendance-register.mjs [--dry-run|--commit] [--file path] [--summary path] [--source-of-truth daily|summary] [--actor uuid] [--report path.xlsx|path.json] [--accept-guesses] [--keep-unmatched]')
      process.exit(0)
    } else throw new Error(`ไม่รู้จัก option ${item}`)
  }
  if (!['daily', 'summary'].includes(args.sourceOfTruth)) {
    throw new Error('--source-of-truth ต้องเป็น daily หรือ summary')
  }
  return args
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}

function cellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return String(value).replace(/\uFEFF/g, '').trim()
}

function normalizeText(value) {
  return cellText(value).normalize('NFC')
    .replace(/[\u200B\u2060]/g, '')
    .replace(/^(?:นางสาว|นาง|นาย|น\.ส\.?|นส\.?|เด็กหญิง|เด็กชาย)/, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('th')
}

function normalizeName(value) {
  return normalizeText(value).replace(/[.\-–—]/g, '')
}

function normalizeCode(value) {
  return normalizeText(value).replace(/[／]/g, '/').replace(/\s*\/\s*/g, '/')
}

function normalizeEphis(value) {
  const text = cellText(value)
  if (!text) return ''
  const normalized = text.replace(/\.0+$/, '').replace(/\s+/g, '')
  return ['0', '-', '—'].includes(normalized) ? '' : normalized
}

function isoDate(year, month, day) {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return ''
  return value
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function findHeader(rows) {
  return rows.findIndex((row) => {
    const values = row.map(normalizeText)
    return values.includes('ลำดับ') && values.includes('ชื่อ-สกุล')
  })
}

function parseSheet(workbook, sheetName, year, month) {
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) return { entries: [], errors: [`ไม่พบ sheet ${sheetName}`], seenPeople: [], duplicates: [] }
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null })
  const headerIndex = findHeader(rows)
  if (headerIndex < 0) return { entries: [], errors: [`ไม่พบหัวตารางใน sheet ${sheetName}`], seenPeople: [], duplicates: [] }
  const header = rows[headerIndex]
  const nameIndex = header.findIndex((value) => normalizeText(value) === 'ชื่อ-สกุล')
  const ephisIndex = header.findIndex((value) => normalizeText(value) === 'เลขที่')
  const noteIndex = header.findIndex((value) => normalizeText(value) === 'หมายเหตุ')
  const dayColumns = new Map()
  for (let column = 0; column < header.length; column += 1) {
    const day = Number(cellText(header[column]))
    if (Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month)) dayColumns.set(column, day)
  }
  if (nameIndex < 0 || ephisIndex < 0 || dayColumns.size !== daysInMonth(year, month)) {
    return { entries: [], errors: [`หัวตาราง ${sheetName} มีคอลัมน์วันที่ไม่ครบตามเดือน`], seenPeople: [], duplicates: [] }
  }

  const entries = []
  const errors = []
  const seenPeople = []
  const duplicates = []
  const seenCells = new Set()
  for (const row of rows.slice(headerIndex + 1)) {
    const sequence = Number(cellText(row[0]))
    const name = cellText(row[nameIndex])
    if (!Number.isFinite(sequence) || sequence <= 0 || !name) continue
    const ephis = normalizeEphis(row[ephisIndex])
    const person = { name, nameKey: normalizeName(name), ephis, sheetName }
    seenPeople.push(person)
    const note = cellText(noteIndex >= 0 ? row[noteIndex] : null) || null
    for (const [column, day] of dayColumns) {
      const rawCode = cellText(row[column])
      if (!rawCode) continue
      const code = EXCEL_CODE_MAP[normalizeCode(rawCode)]
      const recordDate = isoDate(year, month, day)
      if (!recordDate) {
        errors.push(`${sheetName}: วันที่ไม่ถูกต้อง ${year}-${month}-${day}`)
        continue
      }
      if (!code) {
        errors.push(`${sheetName} ${name}: ไม่รู้จักรหัส ${rawCode} วันที่ ${day}`)
        continue
      }
      const cellKey = `${person.nameKey}|${recordDate}|${code}`
      if (seenCells.has(cellKey)) {
        duplicates.push({
          source: 'excel-cell', sheetName, name, ephis: person.ephis,
          recordDate, code, excelCode: normalizeCode(rawCode),
        })
        errors.push(`${sheetName} ${name}: รหัสซ้ำในวัน ${recordDate}`)
        continue
      }
      seenCells.add(cellKey)
      entries.push({ ...person, recordDate, code, excelCode: normalizeCode(rawCode), note })
    }
  }
  return { entries, errors, seenPeople, duplicates }
}

function parseWorkbook(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`ไม่พบไฟล์ ${filePath}`)
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const missingSheets = MONTH_SHEETS.map(([sheet]) => sheet).filter((sheet) => !workbook.SheetNames.includes(sheet))
  const result = {
    entries: [], errors: missingSheets.map((sheet) => `ไม่พบ sheet ประจำเดือน ${sheet}`),
    seenPeople: [], duplicates: [],
  }
  for (const [sheet, year, month] of MONTH_SHEETS) {
    const parsed = parseSheet(workbook, sheet, year, month)
    result.entries.push(...parsed.entries)
    result.errors.push(...parsed.errors)
    result.seenPeople.push(...parsed.seenPeople)
    result.duplicates.push(...parsed.duplicates)
  }
  return result
}

function reconciliationKey(entry) {
  return `${entry.nameKey}|${entry.recordDate}|${entry.code}`
}

function compareEntries(sourceEntries, summaryEntries) {
  const count = (entries) => entries.reduce((map, entry) => map.set(reconciliationKey(entry), (map.get(reconciliationKey(entry)) ?? 0) + 1), new Map())
  const source = count(sourceEntries)
  const summary = count(summaryEntries)
  const keys = new Set([...source.keys(), ...summary.keys()])
  const mismatches = []
  for (const key of keys) {
    const sourceCount = source.get(key) ?? 0
    const summaryCount = summary.get(key) ?? 0
    if (sourceCount === summaryCount) continue
    const sourceEntry = sourceEntries.find((entry) => reconciliationKey(entry) === key)
    const summaryEntry = summaryEntries.find((entry) => reconciliationKey(entry) === key)
    const entry = sourceEntry ?? summaryEntry
    mismatches.push({
      key,
      name: entry?.name ?? '',
      ephis: entry?.ephis ?? '',
      recordDate: entry?.recordDate ?? '',
      code: entry?.code ?? '',
      excelCode: entry?.excelCode ?? '',
      sourceCount,
      summaryCount,
    })
  }
  return mismatches.sort((left, right) => left.key.localeCompare(right.key, 'th'))
}

async function getProfiles() {
  loadEnvFile(path.resolve('.env.local'))
  loadEnvFile(path.resolve('.env'))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local ก่อน dry-run')
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client
    .from('profiles')
    .select('id,ephis_id,name,dept,position_title,employment_type,status,deleted_at')
  if (error) throw new Error(`อ่าน profiles ไม่สำเร็จ: ${error.message}`)
  return { client, profiles: data ?? [] }
}

function sourcePersonKey(person) {
  return `name:${person.nameKey}`
}

function uniquePeople(people) {
  const byKey = new Map()
  for (const person of people) {
    const key = sourcePersonKey(person)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        ...person,
        sourceKey: key,
        sourceEphisValues: person.ephis ? [person.ephis] : [],
      })
      continue
    }
    if (person.ephis && !existing.sourceEphisValues.includes(person.ephis)) {
      existing.sourceEphisValues.push(person.ephis)
    }
  }
  return [...byKey.values()]
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      const insertion = current[rightIndex - 1] + 1
      const deletion = previous[rightIndex] + 1
      current.push(Math.min(substitution, insertion, deletion))
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index]
  }
  return previous[right.length]
}

function nameSimilarity(left, right) {
  if (!left || !right) return 0
  if (left === right) return 1
  return 1 - editDistance(left, right) / Math.max(left.length, right.length)
}

function profileSummary(profile) {
  return {
    userId: String(profile.id),
    name: profile.name ?? '',
    ephis: normalizeEphis(profile.ephis_id),
    dept: profile.dept ?? '',
    positionTitle: profile.position_title ?? '',
    employmentType: profile.employment_type ?? '',
    status: profile.status ?? '',
    deletedAt: profile.deleted_at ?? null,
  }
}

function createProfileIndexes(profiles) {
  const byName = new Map()
  for (const profile of profiles) {
    const nameKey = normalizeName(profile.name)
    if (nameKey) byName.set(nameKey, [...(byName.get(nameKey) ?? []), profile])
  }
  return { byName, profiles }
}

function matchPerson(person, indexes) {
  const nameMatches = indexes.byName.get(person.nameKey) ?? []
  if (nameMatches.length > 1) {
    const matchedProfiles = nameMatches.map(profileSummary)
    return {
      status: 'matched', method: 'name_exact_multiple', sourceKey: sourcePersonKey(person),
      sourceName: person.name, sourceEphis: person.ephis,
      profiles: matchedProfiles, candidates: matchedProfiles,
    }
  }
  if (nameMatches.length === 1) {
    const profile = profileSummary(nameMatches[0])
    return {
      status: 'matched', method: 'name_exact', sourceKey: sourcePersonKey(person),
      sourceName: person.name, sourceEphis: person.ephis,
      profile, profiles: [profile], candidates: [profile],
    }
  }

  const candidates = indexes.profiles
    .map((profile) => ({
      profile: profileSummary(profile),
      score: nameSimilarity(person.nameKey, normalizeName(profile.name)),
    }))
    .filter((candidate) => candidate.score >= FUZZY_SUGGESTION_THRESHOLD)
    .sort((left, right) => right.score - left.score || left.profile.name.localeCompare(right.profile.name, 'th'))
    .slice(0, 3)
  const best = candidates[0]
  const second = candidates[1]
  if (best && best.score >= FUZZY_GUESS_THRESHOLD && (!second || best.score - second.score >= FUZZY_GUESS_MARGIN)) {
    return {
      status: 'guessed', method: 'name_guess', sourceKey: sourcePersonKey(person),
      sourceName: person.name, sourceEphis: person.ephis,
      profile: best.profile, profiles: [best.profile],
      candidates: candidates.map((candidate) => ({ ...candidate.profile, score: Number(candidate.score.toFixed(3)) })),
    }
  }
  return {
    status: candidates.length > 0 ? 'suggested' : 'unresolved',
    method: candidates.length > 0 ? 'name_suggest' : null,
    sourceKey: sourcePersonKey(person), sourceName: person.name, sourceEphis: person.ephis,
    candidates: candidates.map((candidate) => ({ ...candidate.profile, score: Number(candidate.score.toFixed(3)) })),
  }
}

function matchPeople(people, profiles) {
  const indexes = createProfileIndexes(profiles)
  return new Map(uniquePeople(people).map((person) => {
    const match = matchPerson(person, indexes)
    return [person.sourceKey, match]
  }))
}

function matchedProfilesFor(match) {
  return match?.profiles ?? (match?.profile ? [match.profile] : [])
}

function resolveEntries(entries, personMatches, acceptGuesses = false, discardUnmatched = true) {
  const errors = []
  const unresolved = []
  const ambiguous = []
  const guessed = []
  const suggested = []
  const resolved = []
  const duplicates = []
  const discarded = []
  const seenResolved = new Set()
  const seenErrors = new Set()
  const discardEntry = (entry, match, reason) => {
    if (discardUnmatched) {
      discarded.push({
        name: entry.name,
        ephis: entry.ephis,
        recordDate: entry.recordDate,
        code: entry.code,
        excelCode: entry.excelCode,
        reason,
        candidates: match.candidates ?? [],
      })
      return true
    }
    return false
  }
  for (const entry of entries) {
    const match = personMatches.get(sourcePersonKey(entry)) ?? {
      status: 'unresolved', sourceName: entry.name, sourceEphis: entry.ephis, candidates: [],
    }
    if (match.status === 'ambiguous') {
      ambiguous.push(match)
      if (discardEntry(entry, match, 'ambiguous-name')) continue
      const errorKey = `ambiguous:${match.sourceKey}`
      if (!seenErrors.has(errorKey)) {
        seenErrors.add(errorKey)
        errors.push(`ชื่อจับคู่ได้หลาย profile: ${entry.name}`)
      }
      continue
    }
    if (match.status === 'guessed') {
      guessed.push(match)
      if (!acceptGuesses) {
        if (discardEntry(entry, match, 'guess-not-accepted')) continue
        const errorKey = `guess:${match.sourceKey}`
        if (!seenErrors.has(errorKey)) {
          seenErrors.add(errorKey)
          errors.push(`ชื่อเดาต้องตรวจสอบก่อน import: ${entry.name}`)
        }
        continue
      }
    }
    if (match.status === 'suggested') suggested.push(match)
    const matchedProfiles = matchedProfilesFor(match)
    if (!['matched', 'guessed'].includes(match.status) || matchedProfiles.length === 0) {
      unresolved.push({ name: entry.name, ephis: entry.ephis })
      if (discardEntry(entry, match, match.status === 'suggested' ? 'suggestion-not-accepted' : 'name-not-found')) continue
      continue
    }
    for (const profile of matchedProfiles) {
      const userId = profile.userId
      const resolvedKey = `${userId}|${entry.recordDate}|${entry.code}`
      if (seenResolved.has(resolvedKey)) {
        duplicates.push({
          source: 'resolved-record', name: entry.name, ephis: entry.ephis,
          recordDate: entry.recordDate, code: entry.code, excelCode: entry.excelCode,
          profileId: userId,
        })
        errors.push(`รหัสซ้ำของบุคลากรคนเดียวกันในวัน ${entry.recordDate}: ${entry.name}`)
        continue
      }
      seenResolved.add(resolvedKey)
      resolved.push({ ...entry, userId, matchStatus: match.status, matchMethod: match.method })
    }
  }
  const uniqueUnresolved = [...new Map(unresolved.map((item) => [normalizeName(item.name), item])).values()]
  if (!discardUnmatched) {
    for (const item of uniqueUnresolved) errors.push(`จับคู่ชื่อไม่สำเร็จ: ${item.name}`)
  }
  return {
    resolved,
    errors,
    unresolved: uniqueUnresolved,
    ambiguous: [...new Map(ambiguous.map((item) => [item.sourceKey, item])).values()],
    guessed: [...new Map(guessed.map((item) => [item.sourceKey, item])).values()],
    suggested: [...new Map(suggested.map((item) => [item.sourceKey, item])).values()],
    duplicates,
    discarded,
  }
}

function summarize(entries) {
  const byMonth = new Map()
  const byCode = new Map()
  for (const entry of entries) {
    const month = entry.recordDate.slice(0, 7)
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1)
    byCode.set(entry.code, (byCode.get(entry.code) ?? 0) + 1)
  }
  return {
    records: entries.length,
    months: Object.fromEntries([...byMonth.entries()].sort()),
    codes: Object.fromEntries([...byCode.entries()].sort()),
  }
}

function roundNumber(value) {
  return Math.round(Number(value) * 10) / 10
}

function readHalfDayNumber(value, field, rowNumber, errors, allowNegative = false) {
  const text = cellText(value).replace(/,/g, '')
  if (!text) return 0
  const number = Number(text)
  if (!Number.isFinite(number) || (!allowNegative && number < 0) || !Number.isInteger(number * 2)) {
    errors.push(`สรุป แถว ${rowNumber}: ${field} ต้องเป็นจำนวน${allowNegative ? '' : 'วันตั้งแต่ 0 และ'}เพิ่มทีละ 0.5`)
    return null
  }
  return number
}

function parseVacationBalances(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`ไม่พบไฟล์ ${filePath}`)
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const worksheet = workbook.Sheets.สรุป
  if (!worksheet) return { balances: [], people: [], errors: [`ไม่พบ sheet สรุปในไฟล์ ${filePath}`] }
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null })
  const headerIndex = findHeader(rows)
  if (headerIndex < 0) return { balances: [], people: [], errors: ['ไม่พบหัวตารางบุคลากรใน sheet สรุป'] }

  const header = rows[headerIndex]
  const subheader = rows[headerIndex + 1] ?? []
  const nameIndex = header.findIndex((value) => normalizeText(value) === 'ชื่อ-สกุล')
  const ephisIndex = header.findIndex((value) => normalizeText(value) === 'เลขที่')
  const subheaderKey = (value) => normalizeText(value)
  const previousIndex = subheader.findIndex((value) => subheaderKey(value) === 'คงเหลือปีงบ68')
  const currentIndex = subheader.findIndex((value) => subheaderKey(value) === 'ปีงบ2569')
  const totalIndices = subheader
    .map((value, index) => (subheaderKey(value) === 'รวมพักร้อน' ? index : -1))
    .filter((index) => index >= 0)
  const fullUsedIndex = subheader.findIndex((value) => subheaderKey(value) === 'พัก')
  const halfUsedIndex = subheader.findIndex((value) => subheaderKey(value) === 'พ/2')
  const remainingIndex = subheader.findIndex((value) => subheaderKey(value) === 'คงเหลือพักร้อน')
  const errors = []
  if (nameIndex < 0 || previousIndex < 0 || currentIndex < 0) {
    return {
      balances: [], people: [],
      errors: ['หัวตารางสรุปต้องมี ชื่อ-สกุล, คงเหลือปีงบ 68 และ ปีงบ 2569'],
    }
  }

  const balances = []
  const people = []
  for (let index = headerIndex + 2; index < rows.length; index += 1) {
    const row = rows[index]
    const sequence = Number(cellText(row[0]))
    const name = cellText(row[nameIndex])
    if (!Number.isFinite(sequence) || sequence <= 0 || !name) continue
    const person = {
      name,
      nameKey: normalizeName(name),
      ephis: ephisIndex >= 0 ? normalizeEphis(row[ephisIndex]) : '',
      sheetName: 'สรุป',
    }
    people.push(person)
    const rowNumber = index + 1
    const previousDays = readHalfDayNumber(row[previousIndex], 'คงเหลือปีงบ 68', rowNumber, errors)
    const currentDays = readHalfDayNumber(row[currentIndex], 'ปีงบ 2569', rowNumber, errors)
    const excelTotal = totalIndices.length > 0
      ? readHalfDayNumber(row[totalIndices[0]], 'รวมพักร้อน', rowNumber, errors)
      : roundNumber((previousDays ?? 0) + (currentDays ?? 0))
    const excelCappedTotal = totalIndices.length > 1
      ? readHalfDayNumber(row[totalIndices[1]], 'รวมพักร้อนที่ใช้ได้', rowNumber, errors)
      : excelTotal
    const fullUsed = fullUsedIndex >= 0
      ? readHalfDayNumber(row[fullUsedIndex], 'พัก', rowNumber, errors)
      : 0
    const halfUsed = halfUsedIndex >= 0
      ? readHalfDayNumber(row[halfUsedIndex], 'พ/2', rowNumber, errors)
      : 0
    const excelRemaining = remainingIndex >= 0
      ? readHalfDayNumber(row[remainingIndex], 'คงเหลือพักร้อน', rowNumber, errors, true)
      : null
    if ([previousDays, currentDays, excelTotal, excelCappedTotal, fullUsed, halfUsed, excelRemaining]
      .some((value) => value === null)) continue
    balances.push({
      ...person,
      fiscalYear: FISCAL_YEAR,
      previousDays,
      currentDays,
      combinedDays: roundNumber(previousDays + currentDays),
      excelTotal,
      excelCappedTotal,
      excelUsed: roundNumber(fullUsed + halfUsed / 2),
      excelRemaining,
      sourceRow: rowNumber,
    })
  }
  return { balances, people, errors }
}

function entryStatsBySource(entries) {
  const stats = new Map()
  for (const entry of entries) {
    const key = sourcePersonKey(entry)
    const current = stats.get(key) ?? { records: 0, months: new Set(), codes: new Map() }
    current.records += 1
    current.months.add(entry.recordDate.slice(0, 7))
    current.codes.set(entry.code, (current.codes.get(entry.code) ?? 0) + 1)
    stats.set(key, current)
  }
  return stats
}

function vacationUsageBySource(entries) {
  const usage = new Map()
  for (const entry of entries) {
    if (!['vacation', 'vacation_half'].includes(entry.code)) continue
    const key = sourcePersonKey(entry)
    const value = entry.code === 'vacation_half' ? 0.5 : 1
    usage.set(key, roundNumber((usage.get(key) ?? 0) + value))
  }
  return usage
}

function buildMatchReport({ args, daily, summary, vacation, importEntries, personMatches, resolved, reconciliationMismatches, errors }) {
  const importPeople = args.sourceOfTruth === 'daily' ? daily.seenPeople : summary.seenPeople
  const sourcePeople = uniquePeople([...importPeople, ...vacation.people])
  const stats = entryStatsBySource(importEntries)
  const usage = vacationUsageBySource(importEntries)
  const mappings = sourcePeople.map((person) => {
    const match = personMatches.get(person.sourceKey) ?? {
      status: 'unresolved', method: null, candidates: [], sourceKey: person.sourceKey,
    }
    const matchedProfiles = matchedProfilesFor(match)
    const personStats = stats.get(person.sourceKey)
    return {
      status: match.status,
      method: match.method,
      sourceKey: person.sourceKey,
      sourceName: person.name,
      sourceEphis: person.sourceEphisValues.join(', '),
      profileId: matchedProfiles.map((profile) => profile.userId).join(', '),
      profileName: matchedProfiles.map((profile) => profile.name).join(' | '),
      profileEphis: matchedProfiles.map((profile) => profile.ephis).filter(Boolean).join(', '),
      profileDept: matchedProfiles.map((profile) => profile.dept).filter(Boolean).join(' | '),
      profileStatus: matchedProfiles.map((profile) => profile.status).filter(Boolean).join(' | '),
      recordCount: personStats?.records ?? 0,
      months: personStats ? [...personStats.months].sort() : [],
      codes: personStats ? Object.fromEntries([...personStats.codes.entries()].sort()) : {},
      candidates: (match.candidates ?? []).map((candidate) => ({
        userId: candidate.userId, name: candidate.name, ephis: candidate.ephis, score: candidate.score ?? null,
      })),
    }
  })
  const vacationReport = vacation.balances.map((balance) => {
    const match = personMatches.get(sourcePersonKey(balance)) ?? {
      status: 'unresolved', method: null, candidates: [],
    }
    const matchedProfiles = matchedProfilesFor(match)
    const calculatedUsage = usage.get(sourcePersonKey(balance)) ?? 0
    const usageDifference = roundNumber(calculatedUsage - balance.excelUsed)
    return {
      status: match.status,
      method: match.method,
      sourceRow: balance.sourceRow,
      sourceName: balance.name,
      sourceEphis: balance.sourceEphisValues?.join(', ') ?? balance.ephis,
      profileId: matchedProfiles.map((profile) => profile.userId).join(', '),
      profileName: matchedProfiles.map((profile) => profile.name).join(' | '),
      profileEphis: matchedProfiles.map((profile) => profile.ephis).filter(Boolean).join(', '),
      profileDept: matchedProfiles.map((profile) => profile.dept).filter(Boolean).join(' | '),
      previousDays: balance.previousDays,
      currentDays: balance.currentDays,
      combinedDays: balance.combinedDays,
      excelCappedTotal: balance.excelCappedTotal,
      excelUsed: balance.excelUsed,
      calculatedUsage,
      usageDifference,
      usageCheck: Math.abs(usageDifference) < 0.001 ? 'ตรง' : 'ไม่ตรง',
      excelRemaining: balance.excelRemaining,
      candidates: (match.candidates ?? []).map((candidate) => ({
        userId: candidate.userId, name: candidate.name, ephis: candidate.ephis, score: candidate.score ?? null,
      })),
    }
  })
  const statusCounts = mappings.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1
    return counts
  }, {})
  const methodCounts = mappings.reduce((counts, row) => {
    if (row.method && row.status !== 'ambiguous') counts[row.method] = (counts[row.method] ?? 0) + 1
    return counts
  }, {})
  return {
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    sourceOfTruth: args.sourceOfTruth,
    importFile: args.sourceOfTruth === 'daily' ? path.resolve(args.file) : path.resolve(args.summary),
    fiscalYear: FISCAL_YEAR,
    period: '2025-10 ถึง 2026-09',
    files: { daily: path.resolve(args.file), summary: path.resolve(args.summary) },
    daily: summarize(daily.entries),
    summaryWorkbook: summarize(summary.entries),
    matching: {
      sourcePeople: mappings.length,
      statusCounts,
      methodCounts,
      matchedRecords: resolved.resolved.length,
      exactMatchedPeople: mappings.filter((row) => row.status === 'matched').length,
      guessedPeople: mappings.filter((row) => row.status === 'guessed').length,
      suggestedPeople: mappings.filter((row) => row.status === 'suggested').length,
      unresolvedCount: mappings.filter((row) => ['unresolved', 'suggested'].includes(row.status)).length,
      ambiguousCount: mappings.filter((row) => row.status === 'ambiguous').length,
      guessesAccepted: args.acceptGuesses,
      discardUnmatched: args.discardUnmatched,
      discardedRecords: resolved.discarded.length,
      discardedPeople: uniquePeople(resolved.discarded.map((row) => ({
        name: row.name, nameKey: normalizeName(row.name), ephis: row.ephis,
      }))).length,
      mappings,
    },
    vacation: {
      sourceRows: vacation.balances.length,
      matchedRows: vacationReport.filter((row) => ['matched', 'guessed'].includes(row.status)).length,
      exactRows: vacationReport.filter((row) => row.status === 'matched').length,
      guessedRows: vacationReport.filter((row) => row.status === 'guessed').length,
      suggestedRows: vacationReport.filter((row) => row.status === 'suggested').length,
      unresolvedRows: vacationReport.filter((row) => ['unresolved', 'suggested'].includes(row.status)).length,
      ambiguousRows: vacationReport.filter((row) => row.status === 'ambiguous').length,
      guessesAccepted: args.acceptGuesses,
      rows: vacationReport,
    },
    reconciliation: {
      mismatchCount: reconciliationMismatches.length,
      mismatches: reconciliationMismatches,
    },
    duplicates: [...daily.duplicates, ...resolved.duplicates],
    discarded: resolved.discarded,
    errors,
  }
}

function jsonCell(value) {
  return value && typeof value === 'object' ? JSON.stringify(value) : value ?? ''
}

function appendReportSheet(workbook, name, rows, widths = []) {
  const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ สถานะ: 'ไม่มีรายการ' }])
  if (widths.length > 0) worksheet['!cols'] = widths.map((width) => ({ wch: width }))
  XLSX.utils.book_append_sheet(workbook, worksheet, name)
}

function writeMatchReport(report, reportPath) {
  if (!reportPath) return ''
  const outputPath = path.resolve(reportPath)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  if (outputPath.toLowerCase().endsWith('.json')) {
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    return outputPath
  }

  const workbook = XLSX.utils.book_new()
  const matching = report.matching
  appendReportSheet(workbook, 'สรุป', [
    { รายการ: 'โหมด', ค่า: report.mode },
    { รายการ: 'แหล่งข้อมูลหลัก', ค่า: report.sourceOfTruth === 'daily' ? 'ไฟล์วันลารายเดือน' : 'ไฟล์สรุป' },
    { รายการ: 'ช่วงข้อมูล', ค่า: report.period },
    { รายการ: 'รายการรายวันจาก Excel', ค่า: report.daily.records },
    { รายการ: 'รายการจากไฟล์สรุป', ค่า: report.summaryWorkbook.records },
    { รายการ: 'บุคลากรที่พบใน Excel', ค่า: matching.sourcePeople },
    { รายการ: 'จับคู่ชื่อตรง', ค่า: matching.methodCounts.name_exact ?? 0 },
    { รายการ: 'เดาชื่อคะแนนสูง', ค่า: matching.methodCounts.name_guess ?? 0 },
    { รายการ: 'มีชื่อใกล้เคียงให้ตรวจสอบ', ค่า: matching.methodCounts.name_suggest ?? 0 },
    { รายการ: 'จับคู่ชื่อไม่ได้', ค่า: matching.statusCounts.unresolved ?? 0 },
    { รายการ: 'ชื่อเดียวกันใช้หลาย profile', ค่า: matching.methodCounts.name_exact_multiple ?? 0 },
    { รายการ: 'รายการที่พร้อมนำเข้า', ค่า: matching.matchedRecords },
    { รายการ: 'รับรายการเดาเข้า import', ค่า: matching.guessesAccepted ? 'ใช่' : 'ไม่ใช่' },
    { รายการ: 'ตัดรายการจับคู่ไม่ได้ออก', ค่า: matching.discardUnmatched ? 'ใช่' : 'ไม่ใช่' },
    { รายการ: 'รายการที่ไม่เข้า Import', ค่า: matching.discardedRecords },
    { รายการ: 'บุคลากรที่ไม่เข้า Import', ค่า: matching.discardedPeople },
    { รายการ: 'รายการซ้ำ', ค่า: report.duplicates.length },
    { รายการ: 'รายการต่างจากไฟล์สรุป', ค่า: report.reconciliation.mismatchCount },
    { รายการ: 'แถวสิทธิ์พักร้อนจาก sheet สรุป', ค่า: report.vacation.sourceRows },
    { รายการ: 'แถวสิทธิ์พักร้อนที่จับคู่ตรง/เดาได้', ค่า: report.vacation.matchedRows },
    { รายการ: 'ข้อผิดพลาดทั้งหมด', ค่า: report.errors.length },
  ], [34, 24])
  appendReportSheet(workbook, 'จับคู่บุคลากร', matching.mappings.map((row) => ({
    สถานะ: row.status,
    วิธีจับคู่: row.method ?? '',
    ชื่อจากExcel: row.sourceName,
    เลขที่จากExcel: row.sourceEphis,
    ชื่อในระบบ: row.profileName,
    เลขที่ในระบบ: row.profileEphis,
    user_id: row.profileId,
    งาน: row.profileDept,
    สถานะบุคลากร: row.profileStatus,
    จำนวนรายการ: row.recordCount,
    เดือน: row.months.join(', '),
    ผู้สมัครที่พบ: jsonCell(row.candidates),
  })), [14, 12, 30, 14, 30, 14, 38, 24, 14, 12, 30, 60])
  appendReportSheet(workbook, 'เดาชื่อ', matching.mappings.filter((row) => ['guessed', 'suggested'].includes(row.status)).map((row) => ({
    สถานะ: row.status,
    วิธีจับคู่: row.method ?? '',
    ชื่อจากExcel: row.sourceName,
    เลขที่จากExcel: row.sourceEphis,
    ผู้สมัครอันดับ1: row.profileName || row.candidates[0]?.name || '',
    เลขที่ผู้สมัคร: row.profileEphis || row.candidates[0]?.ephis || '',
    คะแนน: row.candidates[0]?.score ?? '',
    คะแนนอันดับสอง: row.candidates[1]?.score ?? '',
    จำนวนรายการ: row.recordCount,
    ผู้สมัครที่พบ: jsonCell(row.candidates),
  })), [14, 16, 30, 14, 30, 14, 12, 16, 12, 80])
  appendReportSheet(workbook, 'จับคู่ไม่ได้', matching.mappings.filter((row) => ['unresolved', 'ambiguous'].includes(row.status)).map((row) => ({
    สถานะ: row.status,
    ชื่อจากExcel: row.sourceName,
    เลขที่จากExcel: row.sourceEphis,
    จำนวนรายการ: row.recordCount,
    ผู้สมัครที่พบ: jsonCell(row.candidates),
  })), [14, 30, 14, 12, 70])
  appendReportSheet(workbook, 'ทิ้งไม่เข้า', report.discarded.map((row) => ({
    เหตุผล: row.reason,
    ชื่อจากExcel: row.name,
    เลขที่จากExcel: row.ephis,
    วันที่: row.recordDate,
    รหัส: row.excelCode ?? row.code,
    ผู้สมัครที่พบ: jsonCell(row.candidates),
  })), [24, 30, 14, 14, 12, 70])
  appendReportSheet(workbook, 'รายการซ้ำ', report.duplicates.map((row) => ({
    แหล่งที่พบ: row.source,
    sheet: row.sheetName ?? '',
    ชื่อ: row.name ?? '',
    เลขที่: row.ephis ?? '',
    วันที่: row.recordDate ?? '',
    รหัส: row.excelCode ?? row.code ?? '',
  })), [18, 14, 30, 14, 14, 12])
  appendReportSheet(workbook, 'พักร้อน', report.vacation.rows.map((row) => ({
    สถานะ: row.status,
    วิธีจับคู่: row.method ?? '',
    ชื่อจากExcel: row.sourceName,
    เลขที่จากExcel: row.sourceEphis,
    ชื่อในระบบ: row.profileName,
    งาน: row.profileDept,
    'คงเหลือปีงบ68': row.previousDays,
    'ปีงบ2569': row.currentDays,
    รวมพักร้อน: row.combinedDays,
    'รวมที่ใช้ได้ในExcel': row.excelCappedTotal,
    ใช้ตามExcel: row.excelUsed,
    ใช้จากรายการรายวัน: row.calculatedUsage,
    ผลเทียบยอดใช้: row.usageCheck,
    คงเหลือในExcel: row.excelRemaining,
    ผู้สมัครที่พบ: jsonCell(row.candidates),
  })), [14, 12, 30, 14, 30, 24, 16, 14, 14, 18, 14, 18, 14, 16, 70])
  appendReportSheet(workbook, 'เทียบไฟล์', report.reconciliation.mismatches.map((row) => ({
    ชื่อ: row.name,
    เลขที่: row.ephis,
    วันที่: row.recordDate,
    รหัส: row.excelCode || row.code,
    จำนวนในไฟล์รายวัน: row.sourceCount,
    จำนวนในไฟล์สรุป: row.summaryCount,
  })), [30, 14, 14, 12, 20, 20])
  appendReportSheet(workbook, 'ข้อผิดพลาด', report.errors.map((error) => ({ ข้อผิดพลาด: error })), [120])
  XLSX.writeFile(workbook, outputPath)
  return outputPath
}

async function commitRows(client, rows, actorId) {
  if (rows.length === 0) return
  const { data: actor, error: actorError } = await client.from('profiles').select('id,role').eq('id', actorId).maybeSingle()
  if (actorError) throw new Error(`ตรวจสอบผู้ import ไม่สำเร็จ: ${actorError.message}`)
  if (!actor) throw new Error('ไม่พบ actor profile สำหรับ --actor')
  if (!['Admin', 'admin'].includes(String(actor.role))) throw new Error('--actor ต้องเป็น profile ที่มี role Admin')
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500)
    const { error } = await client.from('shift_attendance_records').upsert(chunk, { onConflict: 'source_ref' })
    if (error) throw new Error(`commit ชุดที่ ${Math.floor(index / 500) + 1} ไม่สำเร็จ: ${error.message}`)
  }
}

async function commitVacationBalances(client, rows, actorId) {
  if (rows.length === 0) return
  const now = new Date().toISOString()
  const payload = rows.map((row) => ({
    user_id: row.userId,
    fiscal_year: row.fiscalYear,
    previous_days: row.previousDays,
    current_days: row.currentDays,
    created_by: actorId,
    updated_by: actorId,
    updated_at: now,
  }))
  const { error } = await client
    .from('shift_vacation_balances')
    .upsert(payload, { onConflict: 'user_id,fiscal_year' })
  if (error) throw new Error(`commit สิทธิ์พักร้อนไม่สำเร็จ: ${error.message}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'commit' && !args.actor) throw new Error('--commit ต้องระบุ --actor เป็น UUID ของผู้ import')
  const daily = parseWorkbook(args.file)
  const summary = parseWorkbook(args.summary)
  const vacation = parseVacationBalances(args.file)
  const reconciliationMismatches = compareEntries(daily.entries, summary.entries)
  const { client, profiles } = await getProfiles()
  const importWorkbook = args.sourceOfTruth === 'daily' ? daily : summary
  const importEntries = importWorkbook.entries
  const personMatches = matchPeople([...importWorkbook.seenPeople, ...vacation.people], profiles)
  const resolved = resolveEntries(importEntries, personMatches, args.acceptGuesses, args.discardUnmatched)
  const errors = [...importWorkbook.errors, ...vacation.errors, ...resolved.errors]
  if (args.sourceOfTruth !== 'daily' && reconciliationMismatches.length > 0) {
    errors.push(`ไฟล์รายวันกับไฟล์สรุปไม่ตรงกัน ${reconciliationMismatches.length} รายการ`)
  }

  const rows = resolved.resolved.map((entry) => ({
    user_id: entry.userId,
    record_date: entry.recordDate,
    code: entry.code,
    note: entry.note,
    source: 'excel',
    source_ref: `excel:fy2569:${entry.userId}:${entry.recordDate}:${entry.code}`,
    created_by: args.actor || entry.userId,
    updated_by: args.actor || entry.userId,
  }))
  const vacationRows = vacation.balances
    .flatMap((balance) => {
      const match = personMatches.get(sourcePersonKey(balance))
      const canUseMatch = match?.status === 'matched' || (args.acceptGuesses && match?.status === 'guessed')
      if (!canUseMatch) return []
      return matchedProfilesFor(match).map((profile) => ({
        userId: profile.userId,
        fiscalYear: balance.fiscalYear,
        previousDays: balance.previousDays,
        currentDays: balance.currentDays,
      }))
    })

  const report = buildMatchReport({
    args, daily, summary, vacation, importEntries, personMatches, resolved, reconciliationMismatches, errors,
  })
  const reportPath = writeMatchReport(report, args.report)
  console.log(JSON.stringify({
    mode: args.mode,
    sourceOfTruth: args.sourceOfTruth,
    period: '2025-10 ถึง 2026-09',
    source: summarize(importEntries),
    summaryWorkbook: summarize(summary.entries),
    matchedRecords: rows.length,
    matching: {
      sourcePeople: report.matching.sourcePeople,
      exactName: report.matching.exactMatchedPeople,
      sameNameMultipleProfiles: report.matching.methodCounts.name_exact_multiple ?? 0,
      guessedName: report.matching.methodCounts.name_guess ?? 0,
      suggestedName: report.matching.methodCounts.name_suggest ?? 0,
      unresolvedPeople: report.matching.unresolvedCount,
      ambiguousPeople: report.matching.ambiguousCount,
      vacationBalanceRowsReady: vacationRows.length,
      discardedRecords: report.matching.discardedRecords,
      discardedPeople: report.matching.discardedPeople,
    },
    vacation: {
      sourceRows: report.vacation.sourceRows,
      matchedRows: report.vacation.matchedRows,
      unresolvedRows: report.vacation.unresolvedRows,
      ambiguousRows: report.vacation.ambiguousRows,
    },
    reconciliationMismatches: reconciliationMismatches.length,
    duplicateRecords: report.duplicates.length,
    report: reportPath || null,
    errors: errors.slice(0, 50),
  }, null, 2))
  if (errors.length > 0) throw new Error(`หยุดการนำเข้า: พบข้อผิดพลาด ${errors.length} รายการ`)
  if (args.mode === 'commit') {
    await commitRows(client, rows, args.actor)
    await commitVacationBalances(client, vacationRows, args.actor)
  }
  console.log(args.mode === 'commit'
    ? `commit สำเร็จ ทะเบียนรายวัน ${rows.length} รายการ และสิทธิ์พักร้อน ${vacationRows.length} คน`
    : 'dry-run ผ่าน: ยังไม่มีการเขียนข้อมูลลงฐานข้อมูล')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
