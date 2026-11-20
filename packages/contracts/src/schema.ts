/** JSON 参数 Schema 及进程内参数校验。 */
import { z } from 'zod';
import type { JsonObject, JsonValue } from './json.js';
import { assertJsonValue } from './json.js';
export type SchemaDescriptor = JsonObject;
export function validateInput(schema: SchemaDescriptor, input: JsonValue): void {
  assertJsonValue(input, 'Operation input');
  z.fromJSONSchema(JSON.parse(JSON.stringify(schema))).parse(input);
}
/** 能力明确拒绝本次操作，确认没有不确定副作用。 */
export class OperationRejected extends Error {
  constructor(message: string, readonly code: string = 'PROVIDER_ERROR') { super(message); }
}
