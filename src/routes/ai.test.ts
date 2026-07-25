import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import express from "express";
import { userRepository } from "../db/index.js";
import router from "./ai.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ai", router);
  return app;
}

test("POST /api/ai/chat rejects a missing messages array", async (t) => {
  // The router applies the real `authenticateToken` middleware (router.use(authenticateToken)
  // in ai.ts), so a request with no valid JWT never reaches this route's own body validation —
  // it is rejected upstream with 401 first. Stub jwt.verify and the user lookup for the
  // duration of this test so the request clears auth and exercises the route's own
  // `messages` validation, which is what this test targets.
  const originalVerify = jwt.verify;
  const originalFindProfileById = userRepository.findProfileById;
  jwt.verify = (() => ({ userId: "u1" })) as unknown as typeof jwt.verify;
  userRepository.findProfileById = async () => ({ id: "u1", role: "admin" }) as any;
  t.after(() => {
    jwt.verify = originalVerify;
    userRepository.findProfileById = originalFindProfileById;
  });

  const app = makeApp();
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address() as any;

  const response = await fetch(`http://localhost:${port}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
});
