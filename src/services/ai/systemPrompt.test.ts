import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "./systemPrompt.js";

test("buildSystemPrompt: returns the base prompt with no contexts", () => {
  const prompt = buildSystemPrompt(undefined);
  assert.match(prompt, /Uptake/);
  assert.doesNotMatch(prompt, /CURRENT CONTEXT/);
});

test("buildSystemPrompt: appends a rendered context block when contexts are given", () => {
  const prompt = buildSystemPrompt([
    { type: "dataset", id: "ds-1", name: "Sales", metadata: { columns: ["month", "revenue"] } },
  ]);
  assert.match(prompt, /CURRENT CONTEXT/);
  assert.match(prompt, /Sales/);
  assert.match(prompt, /ds-1/);
});
