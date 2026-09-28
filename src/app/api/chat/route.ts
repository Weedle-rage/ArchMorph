import { createArchMorphTools } from "@/lib/webmcp-tools";

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 2048;
const MAX_MESSAGES = 60;
const MAX_BODY_BYTES = 200_000;

const SYSTEM_PROMPT = `You are the ArchMorph design assistant inside a browser-based architectural design studio.
Users sketch floor plans and a 3D model; you help by calling the provided tools to inspect and edit the live project.
Always call inspect_project before planning edits. Use metres. Prefer small, verifiable edits, call validate tools after
structural changes, and end with a short plain-language summary of what changed. This is concept/schematic design only:
never claim building-code compliance or give engineering advice.`;

const unavailable = () => {
  throw new Error("Tool definitions only; execute on the client.");
};

// Tool schemas are built server-side so clients cannot inject arbitrary tool definitions.
const toolDefinitions = createArchMorphTools({
  getProject: unavailable,
  perform: unavailable,
  captureSnapshot: unavailable,
  exportPlan: unavailable,
  noteActivity: unavailable,
}).map((tool, index, all) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema,
  // Cache the whole tool block by marking the last definition.
  ...(index === all.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
}));

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "The AI assistant is not configured." }, { status: 503 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Request too large." }, { status: 413 });

  let messages: unknown;
  try {
    messages = (JSON.parse(raw) as { messages?: unknown }).messages;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return Response.json({ error: "messages must be a non-empty array." }, { status: 400 });
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: toolDefinitions,
      messages,
    }),
  });

  const body = await upstream.text();
  if (!upstream.ok) {
    return Response.json({ error: "The AI service returned an error.", status: upstream.status }, { status: 502 });
  }
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}
