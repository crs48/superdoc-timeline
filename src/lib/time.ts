/** hh:mm for axis ticks and window labels — seconds are noise at bucket scale. */
export function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
