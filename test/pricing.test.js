import test from "node:test";
import assert from "node:assert/strict";
import { PRICE_TIERS, resolveListingPrice } from "../lib/pricing.js";

test("standard single price is centralized at 7.99", () => {
  assert.equal(resolveListingPrice({}), PRICE_TIERS.single);
  assert.equal(resolveListingPrice({ price: 4.99 }), PRICE_TIERS.single);
});

test("explicit price only overrides policy when locked", () => {
  assert.equal(resolveListingPrice({ price: 11.25, price_locked: true }), 11.25);
  assert.equal(resolveListingPrice({ price: 1, price_locked: true }), 2.99);
});

test("bundle ladder increases value without per-path drift", () => {
  assert.equal(resolveListingPrice({ bundle_count: 3 }), 14.99);
  assert.equal(resolveListingPrice({ bundle_count: 5 }), 18.99);
  assert.equal(resolveListingPrice({ bundle_count: 10 }), 24.99);
  assert.equal(resolveListingPrice({ custom: true }), 29.99);
});
