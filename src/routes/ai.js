import express from "express";
import AIService from "../services/aiService.js";
import { validateChatRequest } from "../middleware/aiValidation.js";

const router = express.Router();
const aiService = new AIService();

/**
 * POST /chat
 * Handle chat requests with AI
 */
router.post("/chat", validateChatRequest, async (req, res) => {
  try {
    const { messages } = req.body;

    const result = await aiService.runChat(messages);

    return res.json({
      message: result.text,
      model: result.model,
      ...(result.toolCalls && { toolCalls: result.toolCalls }),
    });
  } catch (error) {
    console.error("AI chat error:", error);
    return res.status(500).json({
      error: "Failed to generate response",
      detail: error?.message || "Unknown error",
    });
  }
});

/**
 * GET /tools
 * Get available AI tools metadata
 */
router.get("/tools", (req, res) => {
  try {
    const tools = aiService.getAvailableTools();
    return res.json({
      tools,
      count: tools.length,
    });
  } catch (error) {
    console.error("Error fetching tools:", error);
    return res.status(500).json({
      error: "Failed to fetch tools",
      detail: error?.message || "Unknown error",
    });
  }
});

export default router;
