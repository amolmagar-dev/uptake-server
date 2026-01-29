/**
 * AI Request Validation Middleware
 * Validates incoming AI requests
 */

import { Request, Response, NextFunction } from "express";

export const validateChatRequest = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const { messages } = req.body;

    // Check messages exist
    if (!messages) {
      res.status(400).json({
        error: "Missing required field",
        detail: "messages field is required",
      });
      return;
    }

    // Check messages is array
    if (!Array.isArray(messages)) {
      res.status(400).json({
        error: "Invalid request format",
        detail: "messages must be an array",
      });
      return;
    }

    // Check messages not empty
    if (messages.length === 0) {
      res.status(400).json({
        error: "Invalid request format",
        detail: "messages array cannot be empty",
      });
      return;
    }

    // Validate message structure
    const validMessages = messages.every(
      (msg: any) =>
        typeof msg === "object" &&
        msg !== null &&
        ("content" in msg || "text" in msg) &&
        ("role" in msg || "type" in msg)
    );

    if (!validMessages) {
      res.status(400).json({
        error: "Invalid message format",
        detail: "Each message must have content/text and role/type fields",
      });
      return;
    }

    next();
  } catch (error: any) {
    res.status(400).json({
      error: "Request validation failed",
      detail: error.message,
    });
  }
};
