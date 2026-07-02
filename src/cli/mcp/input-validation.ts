import type { JsonSchemaObject, JsonSchemaProperty } from './tool-catalog';
import { KyroCoreError } from '../core/errors';

export function validateInput(schema: JsonSchemaObject, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new KyroCoreError('INVALID_INPUT', 'Tool arguments must be an object.');
  const args = value as Record<string, unknown>;
  for (const key of Object.keys(args)) if (!(key in schema.properties)) throw new KyroCoreError('INVALID_INPUT', `Unknown input key: ${key}`);
  for (const required of schema.required ?? []) if (!(required in args)) throw new KyroCoreError('INVALID_INPUT', `Missing required input: ${required}`);
  for (const [key, prop] of Object.entries(schema.properties)) if (key in args) validateProperty(key, prop, args[key]);
  return args;
}

function validateProperty(key: string, prop: JsonSchemaProperty, value: unknown): void {
  if (prop.type === 'array') {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new KyroCoreError('INVALID_INPUT', `${key} must be an array of strings.`);
    return;
  }
  if (typeof value !== prop.type) throw new KyroCoreError('INVALID_INPUT', `${key} must be a ${prop.type}.`);
  if ('enum' in prop && prop.enum && !prop.enum.includes(value as string)) throw new KyroCoreError('INVALID_INPUT', `${key} must be one of ${prop.enum.join(', ')}.`);
}
