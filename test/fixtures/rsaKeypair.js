// Test fixture: an RSA keypair + an RS256 signer.
//
// Used by the JWKS / RS256 verifier tests to sign a real token that
// the verifier can check with a real public key (returned by the
// mocked jwks-rsa client). Generating a fresh keypair per test means
// a leak from one test cannot affect another.
//
// `generateKeyPairSync` is the Node built-in — no extra dependency.
// 2048-bit is the smallest modulus jsonwebtoken / node:crypto agree
// on; 1024 is considered insecure and many libraries refuse it.

import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

/**
 * @returns {{ publicKey: string, privateKey: string }}
 *   PEM-encoded public and private keys.
 */
export function rsaKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return { publicKey, privateKey };
}

/**
 * Sign a payload as an RS256 JWT. The `kid` is stamped into the
 * header so the JWKS verifier can look the matching public key up.
 *
 * @param {object} payload  The JWT claims (sub, organization_id, etc.).
 * @param {string} privateKey  PEM-encoded private key from rsaKeypair().
 * @param {string} kid  Key ID. Must match the kid the JWKS mock returns.
 * @param {object} [opts]  Extra jsonwebtoken sign options (e.g. audience).
 * @returns {string}  The signed JWT.
 */
export function signRs256(payload, privateKey, kid, opts = {}) {
  return jwt.sign(payload, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: "1h",
    ...opts,
  });
}
