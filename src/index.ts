import { ChatSession } from "./durable/ChatSession";
import { ChatWorkflow } from "./workflows/chat_workflow";
import { Buffer } from "node:buffer"; // enabled via nodejs_compat flag

export interface Env {
  AI: Ai;
  CHAT_SESSIONS: DurableObjectNamespace<ChatSession>;
  CHAT_WORKFLOW: Workflow<typeof ChatWorkflow>;
  CORS_ALLOW_ORIGIN: string;
}

type ChatRequest = {
  roomId: string;
  userId?: string;
  text: string;
  model?: string;
};

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.CORS_ALLOW_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      const body = (await request.json()) as ChatRequest;
      if (!body?.roomId || !body?.text) {
        return new Response(JSON.stringify({ error: "roomId and text are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

      // Synchronous fast path: do the chat turn in this Worker.
      const sessionId = env.CHAT_SESSIONS.idFromName(`room:${body.roomId}`);
      const session = env.CHAT_SESSIONS.get(sessionId) as any;

      // Append user message
      await session.append({ role: "user", content: body.text, ts: Date.now() });

      // Load context
      const { summary, messages } = await session.getContext(18);
      const systemPreamble = [
        { role: "system", content: "You are a concise, friendly assistant. Keep answers helpful and safe." },
      ];
      const memory = summary ? [{ role: "system", content: `Conversation memory: ${summary}` }] : [];
      const convo = [...systemPreamble, ...memory, ...messages];

      // Call LLM
      const model = body.model || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      const result = await env.AI.run(model, { messages: convo });
      // @ts-ignore normalize Workers AI responses
      const assistantText = result?.response || (Array.isArray(result?.messages) ? result.messages.at(-1)?.content : "") || "";

      // Persist assistant message
      await session.append({ role: "assistant", content: assistantText, ts: Date.now() });

      // Fire-and-forget: trigger Workflow to summarize in background
      ctx.waitUntil((async () => {
        const id = crypto.randomUUID();
        const instance = await env.CHAT_WORKFLOW.create({ id, params: { roomId: body.roomId, userId: body.userId ?? "anon", text: body.text, model } });
        // Optional: poll once for quick status to surface errors in logs
        try {
          const status = await instance.status();
          if (status.status === "errored") {
            console.error("Workflow errored", status.error);
          }
        } catch (e) {
          console.error("Workflow status error", e);
        }
      })());

      return new Response(JSON.stringify({ text: assistantText }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    if (url.pathname === "/api/voice" && request.method === "POST") {
      // Accept multipart/form-data with field "file"
      const contentType = request.headers.get("Content-Type") || "";
      if (!contentType.includes("multipart/form-data")) {
        return new Response(JSON.stringify({ error: "Expected multipart/form-data with 'file' field" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return new Response(JSON.stringify({ error: "Missing 'file' upload" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }
      const roomId = String(form.get("roomId") || "default");
      const model = String(form.get("model") || "@cf/meta/llama-3.3-70b-instruct-fp8-fast");

      const arrayBuf = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString("base64");

      // 1) Speech-to-text
      const stt = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: base64 });
      // @ts-ignore
      const userText: string = stt?.text ?? "";

      // 2) Chat turn (reusing same logic as /api/chat)
      const sessionId = env.CHAT_SESSIONS.idFromName(`room:${roomId}`);
      const session = env.CHAT_SESSIONS.get(sessionId) as any;
      await session.append({ role: "user", content: userText, ts: Date.now() });
      const { summary, messages } = await session.getContext(18);
      const systemPreamble = [{ role: "system", content: "You are a concise, friendly assistant." }];
      const memory = summary ? [{ role: "system", content: `Conversation memory: ${summary}` }] : [];
      const convo = [...systemPreamble, ...memory, ...messages];
      const llmRes = await env.AI.run(model, { messages: convo });
      // @ts-ignore
      const assistantText: string = llmRes?.response || (Array.isArray(llmRes?.messages) ? llmRes.messages.at(-1)?.content : "");
      await session.append({ role: "assistant", content: assistantText, ts: Date.now() });

      // 3) Text-to-speech (MP3)
      const audioStream = await env.AI.run("@cf/deepgram/aura-2-en", {
        text: assistantText,
        encoding: "mp3",
        
      });
      const headers = new Headers({
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        ...corsHeaders(origin),
      } as any);
      // Return JSON with transcript + text + audio as binary? Better: return audio and X- headers for text.
      headers.set("X-Transcript", encodeURIComponent(userText));
      headers.set("X-Answer-Text", encodeURIComponent(assistantText));
      return new Response(audioStream as any, { headers });
    }

    // Minimal home page to point folks to the Pages UI.
    if (url.pathname === "/" && request.method === "GET") {
      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>cf_ai_llama33_edgechat</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; line-height: 1.4; }
      code { background: #f6f7f9; padding: 0.15rem 0.35rem; border-radius: 4px; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>✅ Cloudflare AI Chat Worker is running</h1>
    <p>Use the API endpoints:</p>
    <ul>
      <li><code>POST /api/chat</code> with JSON <code>{ roomId, text, model? }</code></li>
      <li><code>POST /api/voice</code> with <code>multipart/form-data</code> fields <code>file</code>, <code>roomId</code>, <code>model?</code></li>
    </ul>
    <p>Front-end UI lives in the <code>app/</code> folder. Run <code>npm run pages:dev</code> to try locally, or <code>npm run pages:deploy</code> to publish.</p>
  </body>
</html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders(origin) } });
    }

    return new Response("Not found", { status: 404, headers: { ...corsHeaders(origin) } });
  },
};

export { ChatSession } from "./durable/ChatSession";
export { ChatWorkflow } from "./workflows/chat_workflow";
