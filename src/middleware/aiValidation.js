/**
 * AI Request Validation Middleware
 * Validates incoming AI requests
 */

export const validateChatRequest = (req, res, next) => {
  try {
    const { messages } = req.body;

    // Check messages exist
    if (!messages) {
      return res.status(400).json({
        error: "Missing required field",
        detail: "messages field is required",
      });
    }

    // Check messages is array
    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: "Invalid request format",
        detail: "messages must be an array",
      });
    }

    // Check messages not empty
    if (messages.length === 0) {
      return res.status(400).json({
        error: "Invalid request format",
        detail: "messages array cannot be empty",
      });
    }

    // Validate message structure
    const validMessages = messages.every(
      (msg) =>
        typeof msg === "object" &&
        msg !== null &&
        ("content" in msg || "text" in msg) &&
        ("role" in msg || "type" in msg)
    );

    if (!validMessages) {
      return res.status(400).json({
        error: "Invalid message format",
        detail: "Each message must have content/text and role/type fields",
      });
    }

    next();
  } catch (error) {
    res.status(400).json({
      error: "Request validation failed",
      detail: error.message,
    });
  }
};
