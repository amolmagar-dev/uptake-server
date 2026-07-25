import { ChatOpenAI } from "@langchain/openai";

export function getOpenRouterModel(): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required to use the AI assistant");
  }
  const model = process.env.OPENROUTER_MODEL;
  if (!model) {
    throw new Error(
      "OPENROUTER_MODEL environment variable is required (e.g. a slug from https://openrouter.ai/models)"
    );
  }

  return new ChatOpenAI({
    model,
    apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_APP_URL || "http://localhost:3001",
        "X-Title": "Uptake AI Assistant",
      },
    },
  });
}
