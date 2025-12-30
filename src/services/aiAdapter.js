import { chat , toolDefinition } from "@tanstack/ai";
import { geminiText } from "@tanstack/ai-gemini";
import { z } from "zod";

const getCalendarEventsDef = toolDefinition({
  name: "get_calendar_events",
  description: "Get calendar events for a date",
  inputSchema: z.object({
    date: z.string(),
  }),
});

const getCalendarEvents = getCalendarEventsDef.server(async ({ date }) => {
  // Fetch calendar events
  return { events: [{ date: "2025-12-30", title: "Event 1", description: "make plan to rollout the new feature" }] };
});

const model = process.env.AI_MODEL || "gemini-2.0-flash";

export async function runChat(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }

  const stream = chat({
    adapter: geminiText(model),
    messages,
    tools: [getCalendarEvents],
  });

  // Accumulate text from stream chunks
  let text = "";
  for await (const chunk of stream) {
    if (chunk.type === "content" && chunk.content) {
      text = chunk.content; // content is cumulative, not delta
    }
  }

  return {
    text: text || "No response.",
    model,
  };
}
