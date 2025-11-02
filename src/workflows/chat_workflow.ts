import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

type ChatParams = {
  roomId: string;
  userId: string;
  text: string;
  model?: string;
};

export class ChatWorkflow extends WorkflowEntrypoint<Env, ChatParams> {
  /**
   * Main workflow: append user message, run LLM with memory, persist assistant message,
   * then (optionally) summarize conversation for long-term memory.
   */
  async run(event: WorkflowEvent<ChatParams>, step: WorkflowStep) {
    const { roomId, text } = event.payload;
    const model = event.payload.model || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

    const sessionId = this.env.CHAT_SESSIONS.idFromName(`room:${roomId}`);
    const session = this.env.CHAT_SESSIONS.get(sessionId) as any;

    // 1) Append user message
    await step.do("append user message", async () => {
      await session.append({ role: "user", content: text, ts: Date.now() });
    });

    // 2) Fetch context (summary + last messages)
    const { summary, messages } = await step.do("load context", async () => {
      return await session.getContext(18);
    });

    // 3) Call LLM
    const assistantText = await step.do("llm response", async () => {
      const systemPreamble = [
        { role: "system", content: "You are a concise, friendly assistant. Keep answers helpful and safe." },
      ];
      const memory = summary
        ? [{ role: "system", content: `Conversation memory: ${summary}` }]
        : [];
      const convo = [...systemPreamble, ...memory, ...messages, { role: "user", content: text }];

      // @ts-ignore - Ai type exists at runtime
      const result = await this.env.AI.run(model, { messages: convo });
      // Workers AI returns either { response } or OpenAI-compatible shape. Normalize:
      // @ts-ignore
      const content = (result?.response) || (Array.isArray(result?.messages) ? result.messages.at(-1)?.content : "") || "";
      return typeof content === "string" ? content : (content?.toString?.() ?? "");
    });

    // 4) Persist assistant message
    await step.do("append assistant message", async () => {
      await session.append({ role: "assistant", content: assistantText, ts: Date.now() });
    });

    // 5) If conversation is getting large, (re)create a rolling summary
    await step.do("maybe summarize", async () => {
      const totalChars = await session.approxChars();
      if (totalChars < 10_000) return; // cheap heuristic (~5–6k tokens)
      const ctxForSumm = await session.getContext(40);
      const prompt = [
        { role: "system", content: "Summarize the conversation so far in under 200 words as bullet notes of stable facts, preferences, tasks and decisions. Do NOT include sensitive data, secrets, or ephemeral greeter chitchat."},
        { role: "user", content: JSON.stringify(ctxForSumm.messages) }
      ];
      // Use a smaller model for summarization to save cost
      // @ts-ignore
      const res = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: prompt, max_tokens: 200 });
      // @ts-ignore
      const summ = res?.response || "";
      await session.setSummary(typeof summ === "string" ? summ : String(summ ?? ""));
    });

    // Return a small result object so callers that poll `status()` can see it under `output`
    return { ok: true, text: assistantText };
  }
}
