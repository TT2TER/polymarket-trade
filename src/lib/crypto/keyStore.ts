export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
  version: 1;
}

const ITERATIONS = 200_000;
const KEY_VERSION = 1;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const HEX_PRIVATE_KEY_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKey(password: string, salt: BufferSource, iterations: number): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
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

export function normalizePrivateKey(input: string): string {
  const trimmed = input.trim();
  if (!HEX_PRIVATE_KEY_RE.test(trimmed)) {
    throw new Error('Private key must be 64 hex characters, with or without 0x prefix.');
  }

  return `0x${trimmed.replace(/^0x/i, '').toLowerCase()}`;
}

export async function encryptPrivateKey(privateKey: string, password: string): Promise<EncryptedBlob> {
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt, ITERATIONS);
  const plaintext = new TextEncoder().encode(normalizedPrivateKey);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: ITERATIONS,
    version: KEY_VERSION,
  };
}

export async function decryptPrivateKey(blob: EncryptedBlob, password: string): Promise<string> {
  if (blob.version !== KEY_VERSION || blob.iterations < ITERATIONS) {
    throw new Error('Unsupported encrypted key format.');
  }

  const iv = base64ToBytes(blob.iv);
  const salt = base64ToBytes(blob.salt);
  if (iv.byteLength !== IV_BYTES || salt.byteLength !== SALT_BYTES) {
    throw new Error('Invalid encrypted key metadata.');
  }

  const key = await deriveKey(password, salt, blob.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(blob.ciphertext));
  } catch {
    // AES-GCM 认证失败(密码错误或密文损坏)抛出的 DOMException message 往往为空,
    // 这里替换为明确文案,避免 UI 只显示一个空红框。
    throw new Error('Incorrect password, or the stored key is corrupted.');
  }

  return normalizePrivateKey(new TextDecoder().decode(plaintext));
}
