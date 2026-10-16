import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import known from "@/data/known-domains.json";
import type { Section } from "../utils/dataTypes";

const MODEL = process.env.BRIEF_MODEL ?? "claude-sonnet-5-5";
const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });

const Output = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      facts: z.array(z.object({ text: z.string(), source_url: z.string(), source_title: z.string() })),
    }),
  ),
  why_call_today: z.string(),
});

export type BriefOutput = { sections: Section[]; why_call_today: string };

/**
 * One Claude call with web search and fetch capped at three uses each.
 * The prompts are built in lib/buildFireDeptBrief.ts; this file only talks to the API
 * and validates the JSON that comes back.
 */
export async function fetchFromClaude(system: string, user: string): Promise<BriefOutput> {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 4000,
    system,
    output_config: { effort: "low" },
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 3, blocked_domains: known.blocked },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 6000 },
    ],
    messages: [{ role: "user", content: user }],
  };

  let response = await client.messages.create(params);
  // Server-tool loops can pause; resume by echoing the assistant turn back (at most twice).
  for (let i = 0; i < 2 && response.stop_reason === "pause_turn"; i++) {
    params.messages = [...params.messages, { role: "assistant", content: response.content }];
    response = await client.messages.create(params);
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
  };
}
