import crypto from "node:crypto";
const PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`;
export function generateSessionId(secret) {
  const secretKey = secret ?? crypto.randomUUID().replace(/-/g, "");
  const b64 = Buffer.from(secretKey, "hex").toString("base64");
  const sessionId = crypto.publicEncrypt(
    { key: PEM, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from(b64, "utf-8"),
  ).toString("base64");
  return { secretKey, sessionId };
}
