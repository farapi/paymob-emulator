// Callback timestamp formatting (spec section 14.2): UTC
// YYYY-MM-DDTHH:mm:ss.SSS000, no trailing Z, six fractional digits with the
// last three always zero because the runtime clock is millisecond-resolution.

export function formatCallbackTimestamp(date: Date): string {
  const iso = date.toISOString(); // e.g. "2026-08-14T12:00:00.000Z"
  return `${iso.slice(0, -1)}000`;
}
