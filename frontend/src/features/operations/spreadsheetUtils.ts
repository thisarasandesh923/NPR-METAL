export function colomboTodayIsoDate(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function previewIntervalNetHours(
  startTime: string,
  endTime: string,
  crossesMidnight: boolean,
  deductMinutes: number
): string | null {
  const mStart = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime.trim());
  const mEnd = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(endTime.trim());
  if (!mStart || !mEnd) return null;

  const sMin = Number(mStart[1]) * 60 + Number(mStart[2]);
  const eMin = Number(mEnd[1]) * 60 + Number(mEnd[2]);

  let span = 0;
  if (!crossesMidnight) {
    if (eMin <= sMin) return null;
    span = eMin - sMin;
  } else {
    if (eMin >= sMin) return null;
    span = 1440 - sMin + eMin;
  }

  if (deductMinutes < 0 || deductMinutes >= span) return null;
  return ((span - deductMinutes) / 60).toFixed(2);
}

