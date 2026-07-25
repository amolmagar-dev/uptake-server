import { createAgent } from "langchain";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { getOpenRouterModel } from "../../config/openrouter.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { mapToolResultsToWidgets } from "./widgetMapper.js";
import { buildToolsForUser } from "./tools/index.js";
import type { ChatMessage, AIContext, BaseWidget } from "../../types/ai.js";
import type { UserProfile } from "../../types/database.js";

interface RunChatParams {
  messages: ChatMessage[];
  contexts?: AIContext[];
  user: UserProfile;
}

interface RunChatResult {
  message: string;
  widgets?: BaseWidget[];
}

export async function runChat({ messages, contexts, user }: RunChatParams): Promise<RunChatResult> {
  const agent = createAgent({
    model: getOpenRouterModel(),
    tools: buildToolsForUser(user),
    systemPrompt: buildSystemPrompt(contexts),
  });

  const history = messages
    .filter((m) => m.role !== "system")
    .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

  const result = await agent.invoke({ messages: history });
  const finalMessage = result.messages[result.messages.length - 1];
  const widgets = mapToolResultsToWidgets(result.messages);

  return {
    message: typeof finalMessage?.content === "string" ? finalMessage.content : String(finalMessage?.content ?? ""),
    widgets: widgets.length > 0 ? widgets : undefined,
  };
}
