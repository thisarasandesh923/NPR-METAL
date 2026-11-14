/**
 * Exact fixed-point decimal arithmetic helpers backed by BigInt.
 * Prevents JavaScript IEEE-754 floating-point precision errors in LKR (scale 2)
 * and m³ quantity (scale 3) calculations.
 */

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

export function parseScaledDecimal(
  raw: string | number,
  scale: number,
  fieldName: string
): bigint {
  const str = typeof raw === "number" ? String(raw) : raw.trim();
  if (!str || !DECIMAL_PATTERN.test(str)) {
    throw new Error(`${fieldName} must be a non-negative decimal number.`);
  }

  const [intPart, fracPart = ""] = str.split(".");
  if (fracPart.length > scale) {
    throw new Error(
      `${fieldName} cannot have more than ${scale} decimal places.`
    );
  }

  const paddedFrac = fracPart.padEnd(scale, "0");
  return BigInt(`${intPart}${paddedFrac}`);
}

export function formatScaledDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const raw = abs.toString().padStart(scale + 1, "0");
  const intPart = raw.slice(0, raw.length - scale);
  const fracPart = raw.slice(raw.length - scale);
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}

/**
 * Matches PostgreSQL ROUND(quantity::NUMERIC(10,3) * unit_price::NUMERIC(12,2), 2)
 * using half-away-from-zero rounding on positive scaled values.
 */
export function computeLineTotalCents(
  quantityMilli: bigint,
  unitPriceCents: bigint
): bigint {
  if (quantityMilli < 0n || unitPriceCents < 0n) {
    throw new Error("Quantity and unit price must be non-negative.");
  }
  const productMilliCents = quantityMilli * unitPriceCents;
  return (productMilliCents + 500n) / 1000n;
}

