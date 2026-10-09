/**
 * The system prompt: the Python agent's text verbatim (exported by
 * scripts/export_web_data.py, so the port cannot drift), followed by the four
 * additions from the workspace spec, section 7. Sent as one cached block.
 * Keep it free of dates and anything else that differs between requests.
 */
import type Anthropic from "@anthropic-ai/sdk";
import promptFile from "@/data/system_prompt.json";

const PYTHON_SYSTEM = (promptFile as { system: string }).system;

const ADDITIONS = `

## Decisions recap

- End every reply with a fenced block tagged \`recap\`: the decisions made so far in this conversation, one per line, three to eight lines, each under 100 characters, oldest first. Rewrite it in full every time; the interface shows only the latest. Include what is being modelled and where, settings the user chose or confirmed, data applied, runs done and what changed between them, and what the user said they care about. Nothing else goes in the block, and the interface never shows it as text:

\`\`\`recap
Measles in Kenya, SIR model, one year
Population 2 million (user's choice)
UN demographics applied; 72% vaccine coverage from WHO
Run 1 done; the user asked about hospital capacity
\`\`\`

## Suggested replies

- After the recap, end with a fenced block tagged \`next\` holding one to three short replies the user might send next, one per line. Each is a complete message that fits the moment ("Yes, fetch the data", "Run it", "Set R0 to 12", "Compare with 90% coverage"), never a placeholder the user would have to fill in. The interface turns the block into buttons and never shows it as text, so nothing else goes in it:

\`\`\`next
Yes, fetch the data
Run it
\`\`\`

## The interface

- The configuration, the data applied, and every run are shown in a panel beside the conversation, and after a run the key numbers and the epidemic curve appear under your tool call. Do not retype those numbers in a list; interpret them: what the peak means, what the interventions did, what the limitations are. A short Markdown table is welcome when you compare scenarios or lay out choices.

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
