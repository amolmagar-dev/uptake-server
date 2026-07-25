import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { runChat } from "../services/ai/agentService.js";
import type { ChatMessage, AIContext } from "../types/ai.js";

const router = Router();
router.use(authenticateToken);

router.post("/chat", async (req, res) => {
  try {
    const messages = req.body?.messages as ChatMessage[] | undefined;
    const contexts = req.body?.contexts as AIContext[] | undefined;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages is required and must be a non-empty array" });
    }

    const result = await runChat({ messages, contexts, user: req.user! });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "AI chat failed" });
  }
});

export default router;
