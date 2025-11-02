import { DurableObject } from "cloudflare:workers";

export interface MemoryMessage {
  id?: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  ts?: number;
}

type SummaryRow = { v: string } | null;

export class ChatSession extends DurableObject<Env> {
  private initialized = false;

  private async ensureSchema() {
    if (this.initialized) return;
    // Create tables if they don't exist (SQLite-backed Durable Objects)
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
    `);
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v TEXT
      );
    `);
    this.initialized = true;
  }

  /**
   * Append a message to the conversation.
   */
  public async append(msg: MemoryMessage): Promise<number> {
    await this.ensureSchema();
    const ts = msg.ts ?? Date.now();
    const res = await this.ctx.storage.sql.exec(
      "INSERT INTO messages (role, content, ts) VALUES (?, ?, ?) RETURNING id",
      [msg.role, msg.content, ts]
    );
    // @ts-expect-error types for sql.exec().one() aren't in d.ts yet
    const inserted = await res.one<{ id: number }>();
    return inserted.id;
  }

  /**
   * Return the recent messages plus a saved summary.
   */
  public async getContext(limit = 18): Promise<{ summary: string; messages: MemoryMessage[] }> {
    await this.ensureSchema();
    const rows = await this.ctx.storage.sql.exec(
      "SELECT id, role, content, ts FROM messages ORDER BY id DESC LIMIT ?",
      [limit]
    );
    // @ts-expect-error .rows typing is not published
    const recent = (await rows.rows<MemoryMessage>()).reverse();
    const summaryRow = await this.ctx.storage.sql.exec(
      "SELECT v FROM meta WHERE k = 'summary'"
    );
    // @ts-expect-error .one typing not published
    const summary = ((await summaryRow.one<SummaryRow>())?.v) ?? "";
    return { summary, messages: recent };
  }

  /**
   * Persist a new summary string.
   */
  public async setSummary(summary: string) {
    await this.ensureSchema();
    await this.ctx.storage.sql.exec(
      "INSERT INTO meta (k, v) VALUES ('summary', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      [summary]
    );
  }

  /**
   * Approximate total character count for recent messages used for thresholding.
   */
  public async approxChars(): Promise<number> {
    await this.ensureSchema();
    const res = await this.ctx.storage.sql.exec("SELECT SUM(length(content)) AS n FROM messages");
    // @ts-expect-error
    const n = (await res.one<{ n: number | null }>())?.n ?? 0;
    return n;
  }
}
