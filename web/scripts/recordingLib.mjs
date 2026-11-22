// Turns database rows into the tutorial's recording (tutorial spec, "Making the recording"). Plain JavaScript so the
// export script can run it with Node alone; tests/tutorial/recording.test.ts covers it.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every string in a JSON value, rewritten. */
function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]));
  return value;
}

/**
 * From rows to a recording: turn ids become "practice-N", each run carries its chart series and no run id (so nothing
 * is fetched), every other database id becomes "practice", and the report document is attached. Throws when one of
 * the forbidden strings (the owner's email, its local part) is left anywhere in the text.
 *
 * @param {{ title: string, turns: { userText: string, blocks: any[] }[], series: Record<string, unknown>, report: unknown,
 *           press: Record<string, string>, forbidden: string[] }} input
 */
export function toRecording({ title, turns, series, report, press, forbidden }) {
  const cleanTurns = turns.map((turn, index) => ({
    id: `practice-${index + 1}`,
    userText: turn.userText,
    notice: null,
    blocks: turn.blocks.map((block) => {
      if (block.kind !== "tool_result" || !block.payload || block.payload.kind !== "run") return block;
      const payload = { ...block.payload };
      if (!payload.series && payload.run_id && series[payload.run_id]) payload.series = series[payload.run_id];
      if (!payload.series) throw new Error(`run ${payload.run_id ?? "(no id)"} has no chart series`);
      payload.run_id = null;
      return { ...block, payload };
    }),
  }));
  const recording = mapStrings({ version: 1, title, press, turns: cleanTurns, report }, (text) => text.replace(UUID, "practice"));
  const text = JSON.stringify(recording).toLowerCase();
  for (const word of forbidden) {
    if (word && text.includes(word.toLowerCase())) throw new Error(`the recording still contains "${word}"`);
  }
  return recording;
}
