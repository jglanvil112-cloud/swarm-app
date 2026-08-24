import test from "node:test";
import assert from "node:assert/strict";
import { buildListingCopy } from "../lib/designMeta.js";

test("listing copy uses buyer intent instead of brand stuffing", () => {
  const copy = buildListingCopy({
    subject: "Black Surfer Sunset",
    style: "digital painting",
    keywords: ["black surfer art", "surf wall decor", "ocean sunset art", "coastal black art"],
    collection: "House of Jreym",
    palette: ["orange", "blue"],
  });
  assert.ok(copy.title.length <= 140);
  assert.equal(/house of jreym/i.test(copy.title), false);
  assert.ok(copy.tags.length <= 13);
  assert.equal(copy.price, 7.99);
});

test("description does not promise unattached sizes", () => {
  const copy = buildListingCopy({ subject: "Crowned Queen Portrait", style: "illustration" });
  assert.match(copy.description, /exact downloadable file formats and dimensions/i);
  assert.doesNotMatch(copy.description, /multiple standard sizes/i);
  assert.doesNotMatch(copy.description, /five sizes/i);
});
