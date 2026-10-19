/** Thrown when untrusted input (a recipe, sketch or policy) fails validation. */
export class ValidationError extends Error {
  path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ValidationError";
    this.path = path;
  }
}

// Control characters (C0, DEL, C1) and bidi overrides have no place in display strings.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

export function fail(path: string, message: string): never {
  throw new ValidationError(path, message);
}

/** A plain JSON object whose own keys are all in `allowed` and include all of `required`. */
export function plainObject(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be an object");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(path, "must be a plain object");
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown key");
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) fail(`${path}.${key}`, "is required");
  }
  return obj;
}

export function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a finite number");
  if (integer && !Number.isInteger(value)) fail(path, "must be an integer");
  if (value < min || value > max) fail(path, `must be between ${min} and ${max}`);
  return value;
}

export function string(
  value: unknown,
  path: string,
  maxLength: number,
  pattern?: RegExp,
  minLength = 1,
): string {
  if (typeof value !== "string") fail(path, "must be a string");
  if (value.length < minLength) fail(path, `must be at least ${minLength} characters`);
  if (value.length > maxLength) fail(path, `must be at most ${maxLength} characters`);
  if (UNSAFE_CHARS.test(value)) fail(path, "contains control characters");
  if (pattern && !pattern.test(value)) fail(path, "has an invalid format");
  return value;
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

export function array(value: unknown, path: string, maxItems: number): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  if (value.length > maxItems) fail(path, `must have at most ${maxItems} items`);
  return value;
}

export function stringArray(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number,
  pattern?: RegExp,
): string[] {
  return array(value, path, maxItems).map((v, i) => string(v, `${path}[${i}]`, maxLength, pattern));
}
