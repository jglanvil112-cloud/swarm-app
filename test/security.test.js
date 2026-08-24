import test from "node:test";
import assert from "node:assert/strict";
import {
  isPrivateIp,
  timingSafeEqualText,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "../lib/security.js";

test("timingSafeEqualText requires exact text", () => {
  assert.equal(timingSafeEqualText("abc", "abc"), true);
  assert.equal(timingSafeEqualText("abc", "abd"), false);
  assert.equal(timingSafeEqualText("abc", "abcd"), false);
});

test("signed admin sessions validate and reject tampering", () => {
  const previous = process.env.API_SECRET;
  process.env.API_SECRET = "test-only-secret-value";
  try {
    const now = Date.now();
    const token = createAdminSessionToken(now);
    assert.equal(verifyAdminSessionToken(token, now + 1000), true);
    assert.equal(verifyAdminSessionToken(`${token}00`, now + 1000), false);
    assert.equal(verifyAdminSessionToken(token, now + 13 * 60 * 60 * 1000), false);
  } finally {
    if (previous === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = previous;
  }
});

test("private IPv4 ranges are blocked", () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "172.31.255.1", "192.168.1.10", "169.254.1.1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp("8.8.8.8"), false);
});

test("loopback and private IPv6 are blocked", () => {
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("fd00::1"), true);
  assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
});
