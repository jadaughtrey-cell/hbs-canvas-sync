export const MAX_DAYS = 14;

export function validateDateRange(
  startStr: string,
  endStr: string
): { valid: true; start: Date; end: Date } | { valid: false; error: string } {
  const start = new Date(startStr + "T00:00:00");
  const end   = new Date(endStr   + "T23:59:59");

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: "Invalid date format. Use YYYY-MM-DD." };
  }
  if (start > end) {
    return { valid: false, error: "Start date must be before end date." };
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days > MAX_DAYS) {
    return {
      valid: false,
      error: `Range is ${days} days — maximum is ${MAX_DAYS}. Please select a shorter window.`,
    };
  }
  return { valid: true, start, end };
}
