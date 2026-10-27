import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for values that must be readable again by the server (module settings), as
 * opposed to hashed passwords. AES-256-GCM with a key derived from the configured secret; a sealed value is
 * `v1.<iv>.<tag>.<ciphertext>` in base64url, so it stores as text and the format can change later.
 */
export interface SecretBox {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

const VERSION = 'v1';

/** Any secret becomes a 32-byte key; long random strings are best, but a passphrase works. */
export const deriveKey = (secret: string): Buffer => createHash('sha256').update(secret, 'utf8').digest();

export const createSecretBox = (secret: string): SecretBox => {
  if (!secret) {
    throw new Error('createSecretBox needs a secret');
  }

  const key = deriveKey(secret);

  return {
    seal: (plaintext) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

      return [
        VERSION,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
      ].join('.');
    },
    open: (sealed) => {
      const [version, iv, tag, data] = sealed.split('.');

      if (version !== VERSION || !iv || !tag || !data) {
        throw new Error('Sealed value is malformed');
      }

      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));

      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
};

/** Is this a value `seal` produced? Useful to tell sealed rows from legacy plaintext. */
export const isSealed = (value: string): boolean => value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
