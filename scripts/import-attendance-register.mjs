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

function parseArgs(argv) {
  const args = { file: DEFAULT_DAILY, summary: DEFAULT_SUMMARY, mode: 'dry-run', actor: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--commit') args.mode = 'commit'
    else if (item === '--dry-run') args.mode = 'dry-run'
    else if (item === '--file') args.file = argv[++i] ?? ''
    else if (item === '--summary') args.summary = argv[++i] ?? ''
    else if (item === '--actor') args.actor = argv[++i] ?? ''
    else if (item === '--help' || item === '-h') {
      console.log('Usage: node scripts/import-attendance-register.mjs [--dry-run|--commit] [--file path] [--summary path] [--actor uuid]')
      process.exit(0)
    } else throw new Error(`ไม่รู้จัก option ${item}`)
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

function normalizeCode(value) {
  return normalizeText(value).replace(/[／]/g, '/').replace(/\s*\/\s*/g, '/')
}

function normalizeEphis(value) {
  const text = cellText(value)
  if (!text) return ''
  return text.replace(/\.0+$/, '').replace(/\s+/g, '')
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
  if (!worksheet) return { entries: [], errors: [`ไม่พบ sheet ${sheetName}`], seenPeople: [] }
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null })
  const headerIndex = findHeader(rows)
  if (headerIndex < 0) return { entries: [], errors: [`ไม่พบหัวตารางใน sheet ${sheetName}`], seenPeople: [] }
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
    return { entries: [], errors: [`หัวตาราง ${sheetName} มีคอลัมน์วันที่ไม่ครบตามเดือน`], seenPeople: [] }
  }

  const entries = []
  const errors = []
  const seenPeople = []
  const seenCells = new Set()
  for (const row of rows.slice(headerIndex + 1)) {
    const sequence = Number(cellText(row[0]))
    const name = cellText(row[nameIndex])
    if (!Number.isFinite(sequence) || sequence <= 0 || !name) continue
    const ephis = normalizeEphis(row[ephisIndex])
    const person = { name, nameKey: normalizeText(name), ephis, sheetName }
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
      const cellKey = `${person.ephis || `name:${person.nameKey}`}|${recordDate}|${code}`
      if (seenCells.has(cellKey)) {
        errors.push(`${sheetName} ${name}: รหัสซ้ำในวัน ${recordDate}`)
        continue
      }
      seenCells.add(cellKey)
      entries.push({ ...person, recordDate, code, excelCode: normalizeCode(rawCode), note })
    }
  }
  return { entries, errors, seenPeople }
}

function parseWorkbook(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`ไม่พบไฟล์ ${filePath}`)
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const missingSheets = MONTH_SHEETS.map(([sheet]) => sheet).filter((sheet) => !workbook.SheetNames.includes(sheet))
  const result = { entries: [], errors: missingSheets.map((sheet) => `ไม่พบ sheet ประจำเดือน ${sheet}`), seenPeople: [] }
  for (const [sheet, year, month] of MONTH_SHEETS) {
    const parsed = parseSheet(workbook, sheet, year, month)
    result.entries.push(...parsed.entries)
    result.errors.push(...parsed.errors)
    result.seenPeople.push(...parsed.seenPeople)
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
    if ((source.get(key) ?? 0) !== (summary.get(key) ?? 0)) mismatches.push(key)
  }
  return mismatches
}

async function getProfiles() {
  loadEnvFile(path.resolve('.env.local'))
  loadEnvFile(path.resolve('.env'))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local ก่อน dry-run')
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client.from('profiles').select('id,ephis_id,name')
  if (error) throw new Error(`อ่าน profiles ไม่สำเร็จ: ${error.message}`)
  return { client, profiles: data ?? [] }
}

function resolveEntries(entries, profiles) {
  const byEphis = new Map()
  const byName = new Map()
  for (const profile of profiles) {
    const ephis = normalizeEphis(profile.ephis_id)
    const nameKey = normalizeText(profile.name)
    if (ephis) byEphis.set(ephis, [...(byEphis.get(ephis) ?? []), profile])
    if (nameKey) byName.set(nameKey, [...(byName.get(nameKey) ?? []), profile])
  }
  const errors = []
  const unresolved = []
  const resolved = []
  const seenResolved = new Set()
  for (const entry of entries) {
    const ephisMatches = entry.ephis ? (byEphis.get(entry.ephis) ?? []) : []
    const nameMatches = byName.get(entry.nameKey) ?? []
    let matches = ephisMatches
    if (matches.length === 0) matches = nameMatches
    if (matches.length > 1) {
      errors.push(`ชื่อ/เลขที่จับคู่ได้หลาย profile: ${entry.name} (${entry.ephis || 'ไม่มีเลขที่'})`)
      continue
    }
    if (matches.length === 0) {
      unresolved.push({ name: entry.name, ephis: entry.ephis })
      continue
    }
    const userId = String(matches[0].id)
    const resolvedKey = `${userId}|${entry.recordDate}|${entry.code}`
    if (seenResolved.has(resolvedKey)) {
      errors.push(`รหัสซ้ำของบุคลากรคนเดียวกันในวัน ${entry.recordDate}: ${entry.name}`)
      continue
    }
    seenResolved.add(resolvedKey)
    resolved.push({ ...entry, userId })
  }
  const uniqueUnresolved = [...new Map(unresolved.map((item) => [`${item.ephis}|${item.name}`, item])).values()]
  for (const item of uniqueUnresolved) errors.push(`จับคู่ profile ไม่ได้: ${item.name} (${item.ephis || 'ไม่มีเลขที่'})`)
  return { resolved, errors, unresolved: uniqueUnresolved }
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'commit' && !args.actor) throw new Error('--commit ต้องระบุ --actor เป็น UUID ของผู้ import')
  const daily = parseWorkbook(args.file)
  const summary = parseWorkbook(args.summary)
  const reconciliationMismatches = compareEntries(daily.entries, summary.entries)
  const { client, profiles } = await getProfiles()
  const resolved = resolveEntries(daily.entries, profiles)
  const errors = [...daily.errors, ...resolved.errors]
  if (reconciliationMismatches.length > 0) errors.push(`ไฟล์รายวันกับไฟล์สรุปไม่ตรงกัน ${reconciliationMismatches.length} รายการ`)

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

  console.log(JSON.stringify({
    mode: args.mode,
    period: '2025-10 ถึง 2026-09',
    source: summarize(daily.entries),
    summaryWorkbook: summarize(summary.entries),
    matchedRecords: rows.length,
    unresolvedCount: resolved.unresolved.length,
    reconciliationMismatches: reconciliationMismatches.length,
    errors: errors.slice(0, 50),
  }, null, 2))
  if (errors.length > 0) throw new Error(`หยุดการนำเข้า: พบข้อผิดพลาด ${errors.length} รายการ`)
  if (args.mode === 'commit') await commitRows(client, rows, args.actor)
  console.log(args.mode === 'commit' ? `commit สำเร็จ ${rows.length} รายการ` : 'dry-run ผ่าน: ยังไม่มีการเขียนข้อมูลลงฐานข้อมูล')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
