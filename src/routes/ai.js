import express from "express";
import { runChat } from "../services/aiAdapter.js";

const router = express.Router();

router.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required and cannot be empty" });
    }

    const result = await runChat(messages);
    return res.json({
      message: result.text,
      model: result.model,
    });
  } catch (error) {
    console.error("AI chat error:", error);
    return res.status(500).json({
      error: "Failed to generate response",
      detail: error?.message || "Unknown error",
    });
  }
});

export default router;
