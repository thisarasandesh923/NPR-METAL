import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SALT_LENGTH_BYTES = 16;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length === 0) {
    throw new Error("Password must not be empty");
  }

  const salt = randomBytes(SALT_LENGTH_BYTES);
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });

  return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function parseScryptHash(storedHash: string): {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  expectedKey: Buffer;
} | null {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") {
    return null;
  }

  const paramMatch = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parts[1]);
  if (!paramMatch) {
    return null;
  }

  const N = Number(paramMatch[1]);
  const r = Number(paramMatch[2]);
  const p = Number(paramMatch[3]);

  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 16384 ||
    N > 65536 ||
    (N & (N - 1)) !== 0 ||
    r < 1 ||
    r > 16 ||
    p < 1 ||
    p > 4
  ) {
    return null;
  }

  let salt: Buffer;
  let expectedKey: Buffer;
  try {
    salt = Buffer.from(parts[2], "base64url");
    expectedKey = Buffer.from(parts[3], "base64url");
  } catch {
    return null;
  }

  if (salt.length < 16 || expectedKey.length !== SCRYPT_KEY_LENGTH) {
    return null;
  }

  return { N, r, p, salt, expectedKey };
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parsed = parseScryptHash(storedHash);
  if (!parsed) {
    return false;
  }

  const derived = await scryptAsync(password, parsed.salt, parsed.expectedKey.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: SCRYPT_MAXMEM,
  });

  if (derived.length !== parsed.expectedKey.length) {
    return false;
  }

  return timingSafeEqual(derived, parsed.expectedKey);
}

// Pre-computed valid scrypt hash format used exclusively to equalize timing when a username
// does not exist or an account is inactive (never matches any real password).
const DUMMY_PASSWORD_HASH =
  "scrypt$N=32768,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifyAgainstDummyPassword(
  password: string
): Promise<false> {
  await verifyPassword(password, DUMMY_PASSWORD_HASH);
  return false;
}
