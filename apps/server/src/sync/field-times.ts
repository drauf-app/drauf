/**
 * Per-field last-write-wins timestamps, stored as a JSON object on the entry
 * (epoch ms per field name). Separate module so list logic can use it without
 * importing the operation machinery (which imports list logic).
 */
export function parseFieldTimes(raw: string | null): Record<string, number> {
  if (raw === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const times: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') {
        times[key] = value;
      }
    }
    return times;
  } catch {
    return {};
  }
}

export function stampFieldTimes(raw: string | null, fields: string[], time: number): string {
  const times = parseFieldTimes(raw);
  for (const field of fields) {
    times[field] = time;
  }
  return JSON.stringify(times);
}
