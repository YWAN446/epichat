/**
 * The system prompt: the Python agent's text verbatim (exported by
 * scripts/export_web_data.py, so the port cannot drift), followed by the three
 * additions from the agent-core spec, section 10. Sent as one cached block.
 * Keep it free of dates and anything else that differs between requests.
 */
import type Anthropic from "@anthropic-ai/sdk";
import promptFile from "@/data/system_prompt.json";

const PYTHON_SYSTEM = (promptFile as { system: string }).system;

const ADDITIONS = `

## Suggested replies

- End every reply with a fenced block tagged \`next\` holding one to three short replies the user might send next, one per line. Each is a complete message that fits the moment ("Yes, fetch the data", "Run it", "Set R0 to 12", "Compare with 90% coverage"), never a placeholder the user would have to fill in. The interface turns the block into buttons and never shows it as text, so nothing else goes in it:

\`\`\`next
Yes, fetch the data
Run it
\`\`\`

## Cards

- The interface renders disease parameters, the configuration, fetched data, and simulation results as cards built from your tool results. Do not retype those numbers in tables or lists; interpret them: what the peak means, what the interventions did, what the limitations are.

## Repairs

- When run_simulation reports repairs, say which parameters were changed to make the run succeed and why, before interpreting the results.`;

export const SYSTEM_PROMPT = PYTHON_SYSTEM + ADDITIONS;

export function systemBlocks(): Anthropic.Beta.BetaTextBlockParam[] {
  return [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
}

/** The first message of a conversation carries the date, so the system prompt stays byte-stable. */
export function firstUserMessage(dateIso: string, text: string): string {
  return `Today's date: ${dateIso}.\n\n${text}`;
}
