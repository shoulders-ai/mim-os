import { describe, expect, it } from 'vitest'
import {
  schemaToFields,
  defaultValuesFromFields,
  hasFormFields,
} from './schemaFields.js'

describe('schemaToFields', () => {
  it('returns empty for undefined or missing properties', () => {
    expect(schemaToFields()).toEqual([])
    expect(schemaToFields({})).toEqual([])
    expect(schemaToFields({ properties: 'not-an-object' as unknown })).toEqual([])
  })

  it('maps string properties to text fields', () => {
    const fields = schemaToFields({
      properties: { name: { type: 'string', description: 'Your name' } },
    })
    expect(fields).toEqual([{
      key: 'name',
      type: 'text',
      label: 'name',
      required: false,
      description: 'Your name',
      defaultValue: '',
    }])
  })

  it('maps number and integer properties to number fields', () => {
    const fields = schemaToFields({
      properties: {
        count: { type: 'number', default: 5 },
        limit: { type: 'integer' },
      },
    })
    expect(fields[0]).toMatchObject({ key: 'count', type: 'number', defaultValue: 5 })
    expect(fields[1]).toMatchObject({ key: 'limit', type: 'number', defaultValue: 0 })
  })

  it('maps boolean properties to checkbox fields', () => {
    const fields = schemaToFields({
      properties: { dryRun: { type: 'boolean', default: true } },
    })
    expect(fields[0]).toMatchObject({ key: 'dryRun', type: 'checkbox', defaultValue: true })
  })

  it('maps string enum properties to select fields', () => {
    const fields = schemaToFields({
      properties: { format: { type: 'string', enum: ['pdf', 'html', 'markdown'] } },
    })
    expect(fields[0]).toMatchObject({
      key: 'format',
      type: 'select',
      options: ['pdf', 'html', 'markdown'],
      defaultValue: 'pdf',
    })
  })

  it('maps string enum with explicit default', () => {
    const fields = schemaToFields({
      properties: { format: { type: 'string', enum: ['pdf', 'html'], default: 'html' } },
    })
    expect(fields[0].defaultValue).toBe('html')
  })

  it('maps object and array types to json fallback', () => {
    const fields = schemaToFields({
      properties: {
        config: { type: 'object' },
        tags: { type: 'array' },
      },
    })
    expect(fields[0]).toMatchObject({ key: 'config', type: 'json' })
    expect(fields[1]).toMatchObject({ key: 'tags', type: 'json' })
  })

  it('marks required fields', () => {
    const fields = schemaToFields({
      required: ['path', 'format'],
      properties: {
        path: { type: 'string' },
        format: { type: 'string', enum: ['pdf', 'html'] },
        verbose: { type: 'boolean' },
      },
    })
    expect(fields.find(f => f.key === 'path')!.required).toBe(true)
    expect(fields.find(f => f.key === 'format')!.required).toBe(true)
    expect(fields.find(f => f.key === 'verbose')!.required).toBe(false)
  })

  it('uses title as label when available', () => {
    const fields = schemaToFields({
      properties: { path: { type: 'string', title: 'File path' } },
    })
    expect(fields[0].label).toBe('File path')
  })
})

describe('defaultValuesFromFields', () => {
  it('builds a default values object from field descriptors', () => {
    const fields = schemaToFields({
      required: ['path'],
      properties: {
        path: { type: 'string' },
        count: { type: 'number', default: 10 },
        dryRun: { type: 'boolean' },
        format: { type: 'string', enum: ['pdf', 'html'] },
      },
    })
    const defaults = defaultValuesFromFields(fields)
    expect(defaults).toEqual({
      path: '',
      count: 10,
      dryRun: false,
      format: 'pdf',
    })
  })
})

describe('hasFormFields', () => {
  it('returns true for schemas with typed properties', () => {
    expect(hasFormFields({
      properties: { path: { type: 'string' } },
    })).toBe(true)
  })

  it('returns false for schemas with only json fallback fields', () => {
    expect(hasFormFields({
      properties: { config: { type: 'object' } },
    })).toBe(false)
  })

  it('returns false for undefined schemas', () => {
    expect(hasFormFields()).toBe(false)
  })
})
