// Remake the tutorial's recording from one conversation (tutorial spec, "Making the recording").
//
//   node scripts/export-recording.mjs <conversation id> <owner email> [folder holding .env.local]
//
// Read-only: three selects with the secret key from .env.local. Prints row counts only, never a key or a row.
// The chip texts the tutorial presses are the conversation's own messages, in order: the example, the reply that
// fetches data, the reply that runs, the Try next option, and the reply that asks for the report.
import { writeFileSync } from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { toRecording } from "./recordingLib.mjs";

const [conversationId, email, envDir = process.cwd()] = process.argv.slice(2);
if (!conversationId || !email) {
  console.error("usage: node scripts/export-recording.mjs <conversation id> <owner email> [folder holding .env.local]");
  process.exit(1);
}
nextEnv.loadEnvConfig(envDir, false, { info: () => {}, error: () => {} });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY were not found in .env.local");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function rows(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`${what} read failed: ${error.message}`);
  return data ?? [];
}

const turnRows = await rows(
  admin.from("turns").select("id, seq, user_text, stop, turn_events(seq, kind, payload)").eq("conversation_id", conversationId).in("stop", ["end_turn", "max_tokens"]).order("seq", { ascending: true }),
  "turns",
);
const turns = turnRows.map((row) => ({
  userText: row.user_text,
  blocks: [...(row.turn_events ?? [])]
    .sort((a, b) => a.seq - b.seq)
    .filter((event) => event.kind !== "thinking")
    .map((event) => ({ kind: event.kind, ...event.payload })),
}));
const runIds = turns.flatMap((turn) => turn.blocks.filter((b) => b.kind === "tool_result" && b.payload?.kind === "run" && b.payload.run_id).map((b) => b.payload.run_id));
const runRows = runIds.length > 0 ? await rows(admin.from("runs").select("id, series").in("id", runIds), "runs") : [];
const reportRows = await rows(admin.from("reports").select("title, document, version").eq("conversation_id", conversationId).order("version", { ascending: false }).limit(1), "reports");
console.log(`turns: ${turns.length}, runs: ${runRows.length}, reports: ${reportRows.length}`);
if (turns.length !== 5 || reportRows.length !== 1) {
  console.error("expected five turns (example, fetch data, run, Try next option, report) and one report");
  process.exit(1);
}

const [example, dataReply, runReply, option, reportReply] = turns.map((turn) => turn.userText);
const recording = toRecording({
  title: reportRows[0].title,
  turns,
  series: Object.fromEntries(runRows.map((row) => [row.id, row.series])),
  report: reportRows[0].document,
  press: { example, dataReply, runReply, option, reportReply },
  forbidden: [email, email.split("@")[0]],
});
const out = path.join(process.cwd(), "data", "tutorial", "recording.json");
writeFileSync(out, `${JSON.stringify(recording, null, 1)}\n`);
console.log("wrote data/tutorial/recording.json");
