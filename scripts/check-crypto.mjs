const ITERATIONS = 200_000;
const KEY_VERSION = 1;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const HEX_PRIVATE_KEY_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

async function deriveKey(password, salt, iterations) {
  const passwordBytes = new TextEncoder().encode(password);
  const keyMaterial = await globalThis.crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function normalizePrivateKey(input) {
  const trimmed = input.trim();
  if (!HEX_PRIVATE_KEY_RE.test(trimmed)) {
    throw new Error('Private key must be 64 hex characters, with or without 0x prefix.');
  }

  return `0x${trimmed.replace(/^0x/i, '').toLowerCase()}`;
}

async function encryptPrivateKey(privateKey, password) {
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, ITERATIONS);
  const plaintext = new TextEncoder().encode(normalizedPrivateKey);
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: ITERATIONS,
    version: KEY_VERSION,
  };
}

async function decryptPrivateKey(blob, password) {
  if (blob.version !== KEY_VERSION || blob.iterations < ITERATIONS) {
    throw new Error('Unsupported encrypted key format.');
  }

  const iv = base64ToBytes(blob.iv);
  const salt = base64ToBytes(blob.salt);
  if (iv.byteLength !== IV_BYTES || salt.byteLength !== SALT_BYTES) {
    throw new Error('Invalid encrypted key metadata.');
  }

  const key = await deriveKey(password, salt, blob.iterations);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    base64ToBytes(blob.ciphertext),
  );

  return normalizePrivateKey(new TextDecoder().decode(plaintext));
}

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

test('encrypt/decrypt roundtrip', async () => {
  const value = `0x${'a'.repeat(64)}`;
  const blob = await encryptPrivateKey(value, 'correct horse battery staple');
  const result = await decryptPrivateKey(blob, 'correct horse battery staple');
  if (result !== value) {
    throw new Error('Roundtrip value mismatch.');
  }
});

test('wrong password throws', async () => {
  const blob = await encryptPrivateKey(`0x${'b'.repeat(64)}`, 'right-password');
  let threw = false;
  try {
    await decryptPrivateKey(blob, 'wrong-password');
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('Decrypt unexpectedly succeeded.');
  }
});

test('normalizePrivateKey accepts and rejects expected input', () => {
  const lower = 'c'.repeat(64);
  const upper = 'D'.repeat(64);
  if (normalizePrivateKey(lower) !== `0x${lower}`) {
    throw new Error('Missing-prefix private key was not normalized.');
  }
  if (normalizePrivateKey(`0x${upper}`) !== `0x${upper.toLowerCase()}`) {
    throw new Error('Prefixed private key was not normalized.');
  }

  let threw = false;
  try {
    normalizePrivateKey('not-a-key');
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('Invalid private key was accepted.');
  }
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}
