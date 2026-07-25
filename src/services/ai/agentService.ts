import { createAgent } from "langchain";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { getOpenRouterModel } from "../../config/openrouter.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { mapToolResultsToWidgets } from "./widgetMapper.js";
import { buildToolsForUser } from "./tools/index.js";
import { logger } from "../../utils/logger.js";
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
  logger.info(
    { userId: user.id, userEmail: user.email, messageCount: messages.length, contextCount: contexts?.length },
    "[AI Agent] Starting agent chat execution"
  );

  const agent = createAgent({
    model: getOpenRouterModel(),
    tools: buildToolsForUser(user),
    systemPrompt: buildSystemPrompt(contexts),
  });

  const history = messages
    .filter((m) => m.role !== "system")
    .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

  const result = await agent.invoke({ messages: history });

  // Log all tool calls and responses generated during invocation
  for (const msg of result.messages) {
    if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        logger.info(
          { tool: call.name, toolCallId: call.id, args: call.args },
          `[AI Tool Invocation] Agent called tool: ${call.name}`
        );
      }
    } else if (msg instanceof ToolMessage) {
      let parsedContent: any = msg.content;
      try {
        parsedContent = JSON.parse(String(msg.content));
      } catch {}

      logger.info(
        {
          tool: msg.name,
          toolCallId: msg.tool_call_id,
          success: parsedContent?.success !== false,
          resultSummary: typeof parsedContent === "object" ? parsedContent : String(msg.content).slice(0, 200),
        },
        `[AI Tool Result] Tool ${msg.name || "unknown"} finished execution`
      );
    }
  }

  const finalMessage = result.messages[result.messages.length - 1];
  const widgets = mapToolResultsToWidgets(result.messages);

  logger.info(
    { widgetCount: widgets.length, hasFinalResponse: Boolean(finalMessage) },
    "[AI Agent] Completed agent execution"
  );

  return {
    message: typeof finalMessage?.content === "string" ? finalMessage.content : String(finalMessage?.content ?? ""),
    widgets: widgets.length > 0 ? widgets : undefined,
  };
}
