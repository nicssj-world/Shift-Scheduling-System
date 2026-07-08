import { describe, expect, it } from 'vitest'
import { buildDisplayNames, splitThaiName } from '@/lib/names'

describe('splitThaiName', () => {
  it('strips title prefixes', () => {
    expect(splitThaiName('นางสาวนฤมล งามวชิรพร')).toEqual({ first: 'นฤมล', last: 'งามวชิรพร' })
    expect(splitThaiName('นาย สมชาย ใจดี')).toEqual({ first: 'สมชาย', last: 'ใจดี' })
    expect(splitThaiName('นฤมล พูลขำ')).toEqual({ first: 'นฤมล', last: 'พูลขำ' })
  })
})

describe('buildDisplayNames', () => {
  it('uses first name when unique', () => {
    const names = buildDisplayNames([
      { userId: 'a', fullName: 'นฤมล งามวชิรพร' },
      { userId: 'b', fullName: 'สมชาย ใจดี' },
    ])
    expect(names.get('a')).toBe('นฤมล')
    expect(names.get('b')).toBe('สมชาย')
  })

  it('disambiguates duplicate first names with surname prefix', () => {
    const names = buildDisplayNames([
      { userId: 'a', fullName: 'นฤมล งามวชิรพร' },
      { userId: 'b', fullName: 'นฤมล พูลขำ' },
    ])
    expect(names.get('a')).toBe('นฤมล(งาม)')
    expect(names.get('b')).toBe('นฤมล(พูล)')
  })

  it('extends the prefix until unique', () => {
    const names = buildDisplayNames([
      { userId: 'a', fullName: 'สมศรี วงศ์ทอง' },
      { userId: 'b', fullName: 'สมศรี วงศ์ทองดี' },
    ])
    expect(names.get('a')).not.toBe(names.get('b'))
  })

  it('honours explicit display labels', () => {
    const names = buildDisplayNames([
      { userId: 'a', fullName: 'นฤมล งามวชิรพร', displayLabel: 'นฤมล งาม' },
      { userId: 'b', fullName: 'นฤมล พูลขำ' },
    ])
    expect(names.get('a')).toBe('นฤมล งาม')
    expect(names.get('b')).toBe('นฤมล')
  })
})
