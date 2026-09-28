"use client";

import { useRef, useState } from "react";
import styles from "./ChatPanel.module.css";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type ApiMessage = { role: "user" | "assistant"; content: string | Block[] };
type Line = { id: number; kind: "user" | "assistant" | "tool" | "error"; text: string };

const MAX_STEPS = 12;

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const history = useRef<ApiMessage[]>([]);
  const abort = useRef<AbortController | undefined>(undefined);
  const nextId = useRef(0);

  const push = (kind: Line["kind"], text: string) =>
    setLines((current) => [...current, { id: nextId.current++, kind, text }]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    push("user", text);
    history.current.push({ role: "user", content: text });
    setBusy(true);
    abort.current = new AbortController();
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history.current }),
          signal: abort.current.signal,
        });
        const data = (await response.json()) as { content?: Block[]; stop_reason?: string; error?: string };
        if (!response.ok || !data.content) throw new Error(data.error ?? "The assistant is unavailable.");

        history.current.push({ role: "assistant", content: data.content });
        for (const block of data.content) if (block.type === "text" && block.text.trim()) push("assistant", block.text);

        const calls = data.content.filter((block): block is Extract<Block, { type: "tool_use" }> => block.type === "tool_use");
        if (data.stop_reason !== "tool_use" || calls.length === 0) return;

        const results: Block[] = [];
        for (const call of calls) {
          push("tool", call.name);
          try {
            const invoke = window.__archMorph?.invokeTool;
            if (!invoke) throw new Error("The studio is not ready.");
            const output = await invoke(call.name, call.input);
            results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(output ?? null).slice(0, 20000) });
          } catch (error) {
            results.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: error instanceof Error ? error.message : "Tool failed.",
              is_error: true,
            });
          }
        }
        history.current.push({ role: "user", content: results });
      }
      push("error", "Stopped after too many steps. Ask again to continue.");
    } catch (error) {
      if ((error as Error).name !== "AbortError") push("error", error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.fab} onClick={() => setOpen(true)}>
        AI assistant
      </button>
    );
  }

  return (
    <aside className={styles.panel} aria-label="AI assistant">
      <header className={styles.header}>
        <strong>AI assistant</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant">×</button>
      </header>
      <div className={styles.log}>
        {lines.length === 0 && <p className={styles.hint}>Try: “Add a 4 × 3 m bedroom with a window.”</p>}
        {lines.map((line) => (
          <p key={line.id} className={styles[line.kind]}>
            {line.kind === "tool" ? `Used ${line.text}` : line.text}
          </p>
        ))}
        {busy && <p className={styles.hint}>Working…</p>}
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Describe a change…" disabled={busy} />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <button type="submit">Send</button>
        )}
      </form>
    </aside>
  );
}
