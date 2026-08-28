import test from "node:test";
import assert from "node:assert/strict";

import { formatDuration } from "../src/services/changeCorrelationService.js";

test("formatDuration matches the spec's own example exactly (4m 11s)", () => {
  assert.equal(formatDuration(251), "4m 11s");
});

test("formatDuration omits the minutes component under a minute", () => {
  assert.equal(formatDuration(45), "45s");
});

test("formatDuration handles exactly zero seconds", () => {
  assert.equal(formatDuration(0), "0s");
});

test("formatDuration never goes negative even with an out-of-order timestamp", () => {
  assert.equal(formatDuration(-30), "0s");
});

test("formatDuration handles a large gap in whole minutes", () => {
  assert.equal(formatDuration(3600), "60m 0s");
});
