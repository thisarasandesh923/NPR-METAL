/**
 * Formats a numeric currency value in Sri Lankan Rupees (LKR) with commas and two decimals.
 * Example: 102000 -> "Rs. 102,000.00"
 */
export function formatLkr(amount: number): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `Rs. ${safeAmount.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
