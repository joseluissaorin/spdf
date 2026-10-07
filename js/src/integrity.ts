/**
 * Integrity (contract §8): `content_sha256` over the canonical dump and Ed25519
 * signatures with WebCrypto.
 *
 * - `content_sha256` = lowercase hex SHA-256 of the JCS serialization of the dump with
 *   `meta.content_sha256`, `meta.signature` and `meta.signer` removed.
 * - `signature` = standard base64 of the Ed25519 signature over the ASCII bytes
 *   `spdf-content-sha256:` + that hex; `signer` = `ed25519:` + base64 of the public key.
 */

import { canonicalJson } from './canonical.js';
import { fromBase64, fromHex, sha256Hex, toBase64, utf8 } from './bytes.js';
import type { CanonicalDump } from './dump.js';
import { dumpDocument } from './dump.js';
import type { SpdfDocument } from './document.js';

export const SIGNATURE_DOMAIN = 'spdf-content-sha256:';

/** The hash of a dump (the integrity fields are removed first). */
export async function contentSha256OfDump(dump: CanonicalDump): Promise<string> {
  const meta = { ...((dump.meta as Record<string, unknown>) ?? {}) };
  delete meta.content_sha256;
  delete meta.signature;
  delete meta.signer;
  return sha256Hex(canonicalJson({ ...dump, meta }));
}

/** `content_sha256` of an open document. */
export async function contentSha256(doc: SpdfDocument): Promise<string> {
  return contentSha256OfDump(await dumpDocument(doc));
}

const ED25519 = { name: 'Ed25519' } as const;
const PKCS8_PREFIX = fromHex('302e020100300506032b657004220420');

/** Imports an Ed25519 private key: a CryptoKey, a 32-byte seed or PKCS#8 DER bytes. */
export async function importPrivateKey(key: CryptoKey | Uint8Array): Promise<CryptoKey> {
  if (!(key instanceof Uint8Array)) return key;
  const der = key.byteLength === 32 ? new Uint8Array([...PKCS8_PREFIX, ...key]) : key;
  return crypto.subtle.importKey('pkcs8', der as Uint8Array<ArrayBuffer>, ED25519, true, ['sign']);
}

/** Imports an Ed25519 public key: a CryptoKey, 32 raw bytes, or `ed25519:<base64>`. */
export async function importPublicKey(key: CryptoKey | Uint8Array | string): Promise<CryptoKey> {
  if (typeof key === 'string') key = fromBase64(key.replace(/^ed25519:/, ''));
  if (!(key instanceof Uint8Array)) return key;
  return crypto.subtle.importKey('raw', key as Uint8Array<ArrayBuffer>, ED25519, true, ['verify']);
}

/** A new Ed25519 key pair (`signer` string included). */
export async function generateSigningKey(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; signer: string }> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { ...pair, signer: await signerOf(pair.publicKey) };
}

/** `ed25519:<base64 raw public key>`. */
export async function signerOf(publicKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  return `ed25519:${toBase64(raw)}`;
}

/** Signs a content hash: base64 of Ed25519 over `spdf-content-sha256:<hex>`. */
export async function signContentHash(hash: string, privateKey: CryptoKey | Uint8Array): Promise<string> {
  const key = await importPrivateKey(privateKey);
  const sig = new Uint8Array(await crypto.subtle.sign(ED25519, key, utf8.encode(SIGNATURE_DOMAIN + hash) as Uint8Array<ArrayBuffer>));
  return toBase64(sig);
}

export async function verifyContentHash(hash: string, signature: string, publicKey: CryptoKey | Uint8Array | string): Promise<boolean> {
  try {
    const key = await importPublicKey(publicKey);
    return await crypto.subtle.verify(ED25519, key, fromBase64(signature) as Uint8Array<ArrayBuffer>, utf8.encode(SIGNATURE_DOMAIN + hash) as Uint8Array<ArrayBuffer>);
  } catch {
    return false;
  }
}

export interface IntegrityReport {
  /** Hash recomputed from the content. */
  content_sha256: string;
  /** Hash stored in `spdf_meta`, if any. */
  stored: string | null;
  /** stored === computed (null when nothing is stored). */
  hash_ok: boolean | null;
  /** `signer` stored in the file, if any. */
  signer: string | null;
  /** Signature verifies (null when unsigned). */
  signature_ok: boolean | null;
  /** The signature was checked against the key you passed (not only the one in the file). */
  trusted_key: boolean;
}

/**
 * Checks `content_sha256` and the signature. Pass `publicKey` to check against a key
 * you trust; otherwise the `signer` stored in the file is used (integrity, not identity).
 */
export async function verifyIntegrity(doc: SpdfDocument, publicKey?: CryptoKey | Uint8Array | string): Promise<IntegrityReport> {
  const computed = await contentSha256(doc);
  const stored = doc.meta.content_sha256 ?? null;
  const signature = doc.meta.signature ?? null;
  const signer = doc.meta.signer ?? null;
  let signatureOk: boolean | null = null;
  if (signature) {
    const key = publicKey ?? signer;
    signatureOk = key ? (stored === null || stored === computed) && (await verifyContentHash(computed, signature, key)) : false;
  }
  return {
    content_sha256: computed,
    stored,
    hash_ok: stored === null ? null : stored === computed,
    signer,
    signature_ok: signatureOk,
    trusted_key: publicKey !== undefined,
  };
}

/** Shorthand: true if the file is signed and the signature verifies (with `publicKey` if given). */
export async function verifySignature(doc: SpdfDocument, publicKey?: CryptoKey | Uint8Array | string): Promise<boolean> {
  const r = await verifyIntegrity(doc, publicKey);
  return r.signature_ok === true && r.hash_ok !== false;
}
