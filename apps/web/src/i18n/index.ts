import { de } from './de';

export type Messages = typeof de;

/** Returns the active message catalogue (German until more languages land). */
export function useT(): Messages {
  return de;
}
