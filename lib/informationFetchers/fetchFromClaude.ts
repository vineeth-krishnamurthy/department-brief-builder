import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import known from "@/data/known-domains.json";
import type { RawSection, WebEvidence } from "../citations";

export const MODEL = process.env.BRIEF_MODEL ?? "claude-sonnet-5-5";
const EXPECTED_CHARS = 6000; // rough size of a finished brief, for the progress bar

// Created on first use so a missing key fails this step with a clear message, not the whole route.
let client: Anthropic | null = null;
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set, so the brief can't be written.");
  return (client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 }));
}

export type ClaudeProgress = (fraction: number, detail: string) => void;

const Output = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      facts: z.array(
        z.object({
          text: z.string(),
          source_id: z.string(),
          quote: z.string().optional(),
          source_url: z.string().optional(),
        }),
      ),
    }),
  ),
  why_call_today: z.string(),
});

export type ClaudeOutput = { sections: RawSection[]; why_call_today: string; web: WebEvidence };

/**
 * One Claude call. It reads the raw material gathered by the fetchers; web search and fetch
 * are capped at one use each and the prompt tells it to search only for a required gap.
 * The prompts are built in lib/buildFireDeptBrief.ts; this file only talks to the API,
 * validates the JSON, and records which URLs Claude's own search and fetch actually returned
 * so citations to them can be checked.
 */
export async function fetchFromClaude(system: string, user: string, onProgress?: ClaudeProgress): Promise<ClaudeOutput> {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 6000,
    system,
    output_config: { effort: "low" },
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 1, blocked_domains: known.blocked },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 1, max_content_tokens: 6000 },
    ],
    messages: [{ role: "user", content: user }],
  };

  const web: WebEvidence = { urls: new Map(), texts: new Map() };
  let written = 0;

  // Stream so the progress bar moves while Claude writes; the final message is identical to a normal call.
  const run = async () => {
    const stream = anthropic().messages.stream(params);
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
        onProgress?.(written / EXPECTED_CHARS, event.content_block.name === "web_fetch" ? "reading a page" : "searching the web");
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        written += event.delta.text.length;
        onProgress?.(written / EXPECTED_CHARS, "writing");
      }
    }
    return stream.finalMessage();
  };

  onProgress?.(0, "reading the gathered material");
  let response = await run();
  collectWebEvidence(response.content, web);
  // Server-tool loops can pause; resume by echoing the assistant turn back (at most twice).
  for (let i = 0; i < 2 && response.stop_reason === "pause_turn"; i++) {
    params.messages = [...params.messages, { role: "assistant", content: response.content }];
    response = await run();
    collectWebEvidence(response.content, web);
  }
  if (response.stop_reason === "refusal") throw new Error("The model declined to write this brief.");

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = Output.parse(JSON.parse(json));
  return {
    sections: parsed.sections.filter((s) => s.facts.length > 0),
    why_call_today: parsed.why_call_today,
    web,
  };
}

/** Pull result URLs (and fetched page text) out of server-tool result blocks. Shapes are read defensively. */
function collectWebEvidence(blocks: unknown[], web: WebEvidence) {
  for (const b of blocks as Record<string, unknown>[]) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as Record<string, unknown>[]) {
        if (typeof r.url === "string") web.urls.set(r.url, typeof r.title === "string" ? r.title : "");
      }
    }
    if (b.type === "web_fetch_tool_result" && b.content && typeof b.content === "object") {
      const c = b.content as Record<string, unknown>;
      const url = typeof c.url === "string" ? c.url : null;
      const doc = c.content as Record<string, unknown> | undefined;
      const source = doc?.source as Record<string, unknown> | undefined;
      if (url) {
        web.urls.set(url, typeof doc?.title === "string" ? doc.title : "");
        if (source?.type === "text" && typeof source.data === "string") web.texts.set(url, source.data);
      }
    }
  }
}
