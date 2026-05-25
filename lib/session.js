import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "./constants";

/** @typedef {{ employee_id: string, first_name: string, last_name: string, role: string }} SessionPayload */

function getSecretBytes() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

function b64urlEncode(bytes) {
  let str;
  if (typeof bytes === "string") {
    str = bytes;
  } else {
    str = String.fromCharCode(...bytes);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacSign(message) {
  const key = await crypto.subtle.importKey(
    "raw",
    getSecretBytes(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function hmacVerify(message, signatureBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    getSecretBytes(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(message));
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

/** @returns {Promise<string>} */
export async function createSessionToken(payload) {
  const { employee_id, first_name, last_name, role } = payload;
  const body = {
    employee_id,
    first_name,
    last_name,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC,
  };
  const json = JSON.stringify(body);
  const sig = await hmacSign(json);
  return `${b64urlEncode(json)}.${b64urlEncode(sig)}`;
}

/** @returns {Promise<SessionPayload | null>} */
export async function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  try {
    const [payloadPart, sigPart] = token.split(".");
    const json = atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/"));
    const sigBytes = b64urlDecode(sigPart);
    const valid = await hmacVerify(json, sigBytes);
    if (!valid) return null;

    const body = JSON.parse(json);
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;

    const { employee_id, first_name, last_name, role } = body;
    if (!employee_id || !first_name || !last_name || !role) return null;
    return { employee_id, first_name, last_name, role };
  } catch {
    return null;
  }
}

export { SESSION_COOKIE };
