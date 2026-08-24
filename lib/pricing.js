export const PRICE_TIERS = Object.freeze({
  single: 7.99,
  premiumSingle: 9.99,
  trio: 14.99,
  fourPack: 16.99,
  fivePack: 18.99,
  galleryBundle: 24.99,
  customBundle: 29.99,
});

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function resolveListingPrice(input = {}) {
  const explicit = Number(input.price);
  if (input.price_locked === true && Number.isFinite(explicit)) {
    return money(Math.max(2.99, Math.min(49.99, explicit)));
  }

  const bundleCount = Math.max(1, Number(input.bundle_count) || 1);
  if (input.custom === true || input.kind === "custom") return PRICE_TIERS.customBundle;
  if (bundleCount >= 6) return PRICE_TIERS.galleryBundle;
  if (bundleCount === 5) return PRICE_TIERS.fivePack;
  if (bundleCount === 4) return PRICE_TIERS.fourPack;
  if (bundleCount === 3) return PRICE_TIERS.trio;
  if (input.premium === true || input.kind === "premium") return PRICE_TIERS.premiumSingle;
  return PRICE_TIERS.single;
}

export function priceTierLabel(input = {}) {
  const price = resolveListingPrice(input);
  if (price >= PRICE_TIERS.customBundle) return "custom-bundle";
  if (price >= PRICE_TIERS.galleryBundle) return "gallery-bundle";
  if (price >= PRICE_TIERS.fivePack) return "five-pack";
  if (price >= PRICE_TIERS.fourPack) return "four-pack";
  if (price >= PRICE_TIERS.trio) return "trio";
  if (price >= PRICE_TIERS.premiumSingle) return "premium-single";
  return "single";
}
