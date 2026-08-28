import test from "node:test";
import assert from "node:assert/strict";

import { average } from "../src/services/dashboardService.js";

test("average returns null for an empty list rather than NaN", () => {
  assert.equal(average([]), null);
});

test("average rounds to the nearest whole number", () => {
  assert.equal(average([1, 2]), 2); // 1.5 rounds to 2
  assert.equal(average([10, 20, 30]), 20);
});

test("average handles a single value", () => {
  assert.equal(average([42]), 42);
});
