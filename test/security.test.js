import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, timingSafeEqualText } from "../lib/security.js";

test("timingSafeEqualText requires exact text", () => {
  assert.equal(timingSafeEqualText("abc", "abc"), true);
  assert.equal(timingSafeEqualText("abc", "abd"), false);
  assert.equal(timingSafeEqualText("abc", "abcd"), false);
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
