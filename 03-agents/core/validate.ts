// ============================================================
// TOOL INPUT VALIDATION
// ============================================================
// The model's tool input is checked against the tool's inputSchema
// BEFORE anything runs or a human is asked. WHY: the schema sent to
// the API only guides the model; it is not enforced on what comes
// back. A fooled or buggy model can send a missing field, a number
// where a string belongs, a value outside an enum, an extra field
// the tool never asked for, or a 50,000 character "reason". Each of
// those is refused here and the model is told why.
//
// Deliberately small (no new dependency): it covers exactly the
// schema features our tools use.
//   - the input is a plain object
//   - required fields are present
//   - each field has its declared primitive type
//   - enum values are respected
//   - no extra fields (additionalProperties is always false here)
//   - strings are capped (maxLength, or a default cap)
// ============================================================

import type { AgentTool, PropertySchema } from "./types.ts";

export const DEFAULT_MAX_STRING = 2000;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function typeOk(value: unknown, type: PropertySchema["type"]): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
  }
}

// Returns a list of problems; an empty list means the input is valid
export function validateInput(schema: AgentTool["inputSchema"], input: unknown): string[] {
  if (!isPlainObject(input)) return ["input must be an object"];
  const errors: string[] = [];

  for (const name of schema.required ?? []) {
    if (!(name in input) || input[name] === undefined || input[name] === null) {
      errors.push(`${name} is required`);
    }
  }

  for (const [name, value] of Object.entries(input)) {
    const prop = schema.properties[name];
    if (!prop) {
      errors.push(`${name} is not an allowed field`);
      continue;
    }
    if (value === undefined || value === null) continue; // missing: handled by "required"
    if (!typeOk(value, prop.type)) {
      errors.push(`${name} must be a ${prop.type}`);
      continue;
    }
    if (prop.enum && !prop.enum.includes(value as string)) {
      errors.push(`${name}: ${JSON.stringify(value)} is not one of ${prop.enum.join(", ")}`);
    }
    if (typeof value === "string") {
      const max = prop.maxLength ?? DEFAULT_MAX_STRING;
      if (value.length > max) errors.push(`${name} is longer than ${max} characters`);
    }
  }
  return errors;
}
