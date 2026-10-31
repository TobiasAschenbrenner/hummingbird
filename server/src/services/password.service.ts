import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
}

let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  return (dummyHash ??= hashPassword(randomBytes(32).toString('base64url')));
}

export async function verifyPassword(password: string, passwordHash?: string): Promise<boolean> {
  const enabled = passwordHash?.startsWith('$argon2id$') ?? false;
  const candidate = enabled ? passwordHash! : await getDummyHash();
  try {
    const matches = await verify(candidate, password);
    return enabled && matches;
  } catch {
    // Disabled and malformed hashes still perform a password verification.
    await verify(await getDummyHash(), password);
    return false;
  }
}
