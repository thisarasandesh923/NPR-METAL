/**
 * Exact integer-minute time interval and duration helpers for worker attendance
 * and machine working-hour logs. Uses BigInt fixed-point rounding to avoid floats.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function parseTimeToMinutes(raw: string, fieldName: string): number {
  const trimmed = raw.trim();
  const match = TIME_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`${fieldName} must be in valid 24-hour HH:MM format.`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

export function normalizeTimeString(raw: string, fieldName: string): string {
  const mins = parseTimeToMinutes(raw, fieldName);
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

export function computeIntervalSpanMinutes(
  startTime: string,
  endTime: string,
  crossesMidnight: boolean
): number {
  const startMin = parseTimeToMinutes(startTime, "Start time");
  const endMin = parseTimeToMinutes(endTime, "End time");

  if (!crossesMidnight) {
    if (endMin <= startMin) {
      throw new Error(
        "End time must be after start time unless Overnight Shift is enabled."
      );
    }
    return endMin - startMin;
  }

  if (endMin >= startMin) {
    throw new Error(
      "Overnight Shift requires end time on the next day to be earlier than start time."
    );
  }
  return 24 * 60 - startMin + endMin;
}

export function minutesToDecimalHours(totalMinutes: number): string {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    throw new Error("Minutes must be a non-negative integer.");
  }
  const hundredths = (BigInt(totalMinutes) * 100n + 30n) / 60n;
  const intPart = (hundredths / 100n).toString();
  const fracPart = (hundredths % 100n).toString().padStart(2, "0");
  return `${intPart}.${fracPart}`;
}

export interface AbsoluteMinuteRange {
  startAbs: number;
  endAbs: number;
}

/**
 * Converts a local work_date (YYYY-MM-DD) + start/end HH:MM + crossesMidnight
 * into continuous UTC-day-offset minutes so adjacent-day overlaps are detected accurately.
 */
export function toAbsoluteMinuteRange(
  workDate: string,
  startTime: string,
  endTime: string,
  crossesMidnight: boolean
): AbsoluteMinuteRange {
  const [y, m, d] = workDate.slice(0, 10).split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  const dayBase = dayNumber * 1440;
  const startMin = parseTimeToMinutes(startTime, "Start time");
  const spanMin = computeIntervalSpanMinutes(startTime, endTime, crossesMidnight);
  return {
    startAbs: dayBase + startMin,
    endAbs: dayBase + startMin + spanMin,
  };
}

export function rangesOverlap(
  a: AbsoluteMinuteRange,
  b: AbsoluteMinuteRange
): boolean {
  return a.startAbs < b.endAbs && b.startAbs < a.endAbs;
}

