/**
 * Formats a numeric or fixed-point decimal currency value in Sri Lankan Rupees (LKR)
 * with comma separators and two decimal places.
 * Example: "102000.00" -> "Rs. 102,000.00"
 */
export function formatLkr(amount: number | string): string {
  if (typeof amount === "string") {
    const trimmed = amount.trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (match) {
      const sign = match[1];
      const intPart = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const fracPart = (match[3] ?? "").slice(0, 2).padEnd(2, "0");
      return `${sign}Rs. ${intPart}.${fracPart}`;
    }
  }

  const numeric = typeof amount === "number" ? amount : Number(amount);
  const safeAmount = Number.isFinite(numeric) ? numeric : 0;
  return `Rs. ${safeAmount.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatColomboDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  try {
    return new Intl.DateTimeFormat("en-LK", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatColomboDate(dateValue: string): string {
  const date = new Date(dateValue.includes("T") ? dateValue : `${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }
  try {
    return new Intl.DateTimeFormat("en-LK", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(date);
  } catch {
    return dateValue;
  }
}
