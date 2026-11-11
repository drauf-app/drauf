import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUIDv7, so ids created later also sort later. */
export function newId(): string {
  return uuidv7();
}
