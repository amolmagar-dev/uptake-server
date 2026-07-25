import { test } from "node:test";
import assert from "node:assert/strict";
import { getOpenRouterModel } from "./openrouter.js";

test("throws a clear error when OPENROUTER_API_KEY is missing", () => {
  const original = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  try {
    assert.throws(() => getOpenRouterModel(), /OPENROUTER_API_KEY/);
  } finally {
    if (original) process.env.OPENROUTER_API_KEY = original;
    if (originalModel) process.env.OPENROUTER_MODEL = originalModel;
  }
});

test(
  "openrouter model responds to a trivial prompt",
  { skip: !process.env.OPENROUTER_API_KEY ? "OPENROUTER_API_KEY not set" : false },
  async () => {
    const model = getOpenRouterModel();
    const response = await model.invoke("Reply with exactly the word: pong");
    assert.ok(typeof response.content === "string" && response.content.length > 0);
  }
);
