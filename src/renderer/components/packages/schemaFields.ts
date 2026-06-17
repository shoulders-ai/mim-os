/**
 * Pure mapping from a JSON Schema (job inputSchema) to form field descriptors.
 * No form framework — just data. The component renders fields from this output.
 */

export type FieldType = 'text' | 'number' | 'checkbox' | 'select' | 'json'

export interface SchemaField {
  key: string
  type: FieldType
  label: string
  required: boolean
  /** For select fields */
  options?: string[]
  /** Schema-level description, if any */
  description?: string
  /** Default value from the schema */
  defaultValue?: unknown
}

export interface JobInputSchema {
  type?: string
  required?: unknown
  properties?: unknown
}

/**
 * Derive form fields from a JSON Schema object definition.
 * Handles: string -> text, number/integer -> number, boolean -> checkbox,
 * string with enum -> select, everything else -> json textarea fallback.
 */
export function schemaToFields(schema?: JobInputSchema): SchemaField[] {
  if (!schema) return []
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []

  const requiredSet = new Set(
    Array.isArray(schema.required)
      ? (schema.required as unknown[]).filter((item): item is string => typeof item === 'string')
      : [],
  )

  const props = properties as Record<string, Record<string, unknown>>
  const fields: SchemaField[] = []

  for (const [key, prop] of Object.entries(props)) {
    if (!prop || typeof prop !== 'object' || Array.isArray(prop)) continue
    fields.push(propertyToField(key, prop, requiredSet.has(key)))
  }

  return fields
}

function propertyToField(
  key: string,
  prop: Record<string, unknown>,
  required: boolean,
): SchemaField {
  const description = typeof prop.description === 'string' ? prop.description : undefined
  const label = typeof prop.title === 'string' ? prop.title : key

  // String with enum -> select
  if (prop.type === 'string' && Array.isArray(prop.enum)) {
    const options = prop.enum.filter((v): v is string => typeof v === 'string')
    if (options.length > 0) {
      return {
        key,
        type: 'select',
        label,
        required,
        options,
        description,
        defaultValue: typeof prop.default === 'string' ? prop.default : options[0],
      }
    }
  }

  // String -> text input
  if (prop.type === 'string') {
    return {
      key,
      type: 'text',
      label,
      required,
      description,
      defaultValue: typeof prop.default === 'string' ? prop.default : '',
    }
  }

  // Number or integer -> number input
  if (prop.type === 'number' || prop.type === 'integer') {
    return {
      key,
      type: 'number',
      label,
      required,
      description,
      defaultValue: typeof prop.default === 'number' ? prop.default : 0,
    }
  }

  // Boolean -> checkbox
  if (prop.type === 'boolean') {
    return {
      key,
      type: 'checkbox',
      label,
      required,
      description,
      defaultValue: typeof prop.default === 'boolean' ? prop.default : false,
    }
  }

  // Everything else (object, array, mixed) -> JSON textarea fallback
  return {
    key,
    type: 'json',
    label,
    required,
    description,
    defaultValue: prop.default,
  }
}

/**
 * Build a default values object from field descriptors.
 * Used to initialize form state.
 */
export function defaultValuesFromFields(fields: SchemaField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue
    } else if (field.type === 'text' || field.type === 'select') {
      values[field.key] = ''
    } else if (field.type === 'number') {
      values[field.key] = 0
    } else if (field.type === 'checkbox') {
      values[field.key] = false
    }
    // json fields with no default: omit (user fills in manually)
  }
  return values
}

/**
 * Whether a schema has typed properties that can be rendered as form fields
 * (not just a JSON fallback).
 */
export function hasFormFields(schema?: JobInputSchema): boolean {
  const fields = schemaToFields(schema)
  return fields.length > 0 && fields.some(f => f.type !== 'json')
}
