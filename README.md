# cf_ai_llama33_edgechat

**An AI-powered chat + voice demo on Cloudflare** using **Workers AI (Llama 3.3)**, **Durable Objects** for memory, a **Workflow** for coordination/summarization, and a lightweight **Pages** UI.

> ✅ This repo matches the assignment requirements:  
> - LLM: Workers AI (Meta **Llama 3.3 70B** by default)  
> - Workflow/coordination: **Cloudflare Workflows** + **Durable Objects**  
> - User input: **chat UI** (Pages) and **voice (push‑to‑talk)**  
> - Memory/state: **SQLite‑backed Durable Object** summarization  
> - Documentation: README with **local + deploy** steps  
> - `PROMPTS.md`: contains the AI prompts used while building

---

## Live architecture (at a glance)

```
Pages (app/) ── UI (chat + push‑to‑talk) → Worker (/api/chat, /api/voice)
                                            │
                                            ├─ Durable Object (ChatSession, SQLite) ← stores messages + summary
                                            │
                                            ├─ Workers AI (LLMs: Llama 3.3 / Llama 3.1 8B)
                                            └─ Workflows (ChatWorkflow) → background summarization/housekeeping
```

- Workers AI model slugs and SDK usage follow CF docs (for example **`@cf/meta/llama-3.3-70b-instruct-fp8-fast`** and the `env.AI.run()` API). citeturn2view0  
- Durable Objects use **SQLite storage** and the **SQL API** (`ctx.storage.sql`) to store chat messages + a rolling summary. citeturn10view0  
- The voice path uses **Whisper Large V3 Turbo** for STT and **Deepgram Aura‑2** for TTS on Workers AI. citeturn7view0turn6view0  
- A **Workflow** coordinates a multi‑step pipeline (append → load context → LLM → persist → maybe summarize), and can be triggered from the Worker via a binding (`env.MY_WORKFLOW.create(...)`). citeturn8view0turn9view0

---

## Prerequisites

- Node 18+
- A Cloudflare account with **Wrangler** logged in (`npm create cloudflare@latest` or `npx wrangler login`).
- Workers AI enabled on your account (Free plan works). Bindings are created via Wrangler config.

---

## Quick start (local)

```bash
git clone <this-repo-url> cf_ai_llama33_edgechat
cd cf_ai_llama33_edgechat
npm install

# Start the Worker on http://127.0.0.1:8787
npm run dev
# In another terminal, serve the UI on a local Pages dev server
npm run pages:dev
```

- Open the UI at the URL printed by `pages:dev` (typically http://127.0.0.1:8788).  
- The UI auto-detects an API base; if needed, set one manually in dev tools:  
  ```js
  localStorage.setItem("API_BASE", "http://127.0.0.1:8787");
  location.reload();
  ```

### Try the APIs directly

- **Chat:**

  ```bash
  curl -X POST http://127.0.0.1:8787/api/chat     -H "Content-Type: application/json"     -d '{"roomId":"demo","text":"Give me three fun facts about puffins."}'
  ```

- **Voice (push‑to‑talk):** send a short `audio/*.mp3|wav` file:

  ```bash
  curl -X POST http://127.0.0.1:8787/api/voice     -F roomId=demo     -F file=@/path/to/clip.wav --output reply.mp3
  open reply.mp3
  ```

---

## Deploy

### Worker (API)

```bash
npm run deploy
```

This deploys to your `*.workers.dev` subdomain. You can bind Workers AI in `wrangler.toml`:

```toml
[ai]
binding = "AI"  # available as env.AI in your Worker
```

Workers AI **model slugs** and **usage examples** come from official docs (e.g. `env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages })`). citeturn2view0

### Pages (UI)

```bash
npm run pages:deploy
```

This publishes the `app/` directory. If your UI is on Pages and API on Workers, CORS is enabled by default to `*`. Set `CORS_ALLOW_ORIGIN` in `wrangler.toml` to your Pages domain for stricter CORS.

---

## What’s implemented

- **Chat** endpoint: builds context from **Durable Object memory** (summary + latest turns) then calls **Workers AI** Llama 3.3 (or switch to **Llama 3.1 8B** from the UI). citeturn2view0turn13view0  
- **Voice** endpoint: `multipart/form-data` upload → **Whisper v3 Turbo** STT → LLM answer → **Deepgram Aura‑2** TTS MP3 stream back to the browser. citeturn7view0turn6view0  
- **Durable Object memory**: SQLite tables (`messages`, `meta.summary`). Simple character-count heuristic triggers summarization. citeturn10view0  
- **Workflow**: `ChatWorkflow` runs the multi‑step process and writes output; the Worker triggers it via binding for rolling summarization/housekeeping. citeturn8view0turn9view0

---

## File map

```
src/
  index.ts                      # Worker routes (/api/chat, /api/voice, /)
  durable/ChatSession.ts        # Durable Object (SQLite) with messages & summary
  workflows/chat_workflow.ts    # Workflows pipeline (append → LLM → persist → summarize)

app/
  index.html, style.css, app.js # Pages UI (chat + push‑to‑talk)

wrangler.toml                   # AI, DO, Workflow bindings; migrations; CORS
PROMPTS.md                      # Prompts used during build
```

---

## Notes, limits & costs

- Default model is **Llama 3.3 70B (fp8 fast)**. You can swap models in the UI or via JSON. Check the **Models** catalog and pricing in CF docs. citeturn1view0turn2view0
- **Whisper** STT and **Deepgram Aura‑2** TTS have their own unit pricing. See model pages. citeturn7view0turn6view0
- The DO summary heuristic uses total characters; for production, prefer token-based accounting and redaction where required.
- For real-time duplex voice (interruptions, VAD, WebRTC), use **Cloudflare Realtime Agents**; this demo chooses a simpler push‑to‑talk path. citeturn3view0

---

## References

- Workers AI overview & binding usage. citeturn0search1turn5search10  
- Llama 3.3 70B usage (`env.AI.run`, streaming & JSON modes). citeturn2view0  
- Llama 3.1 8B usage. citeturn13view0  
- Whisper Large V3 Turbo (ASR) usage example. citeturn7view0  
- Deepgram Aura‑2 (TTS) parameters & output. citeturn6view0  
- Durable Objects: getting started and SQLite migrations (`new_sqlite_classes`). citeturn10view0  
- Workflows overview & triggering from Workers. citeturn8view0turn9view0
