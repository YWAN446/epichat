/** The tutorial's recorded practice conversation (tutorial spec, "Decided how"): its shape, and the check that today's steps can play it. */
import { z } from "zod";
import type { DisplayTurn } from "@/components/Turn";
import recordingFile from "@/data/tutorial/recording.json";
import type { Block } from "@/lib/chat/events";
import { deriveArtifacts } from "@/lib/client/artifacts";
import { DRAFTS } from "@/lib/client/drafts";
import { tryNextLabels } from "@/lib/client/tryNext";
import { lastSuggestions } from "@/lib/client/turn";
import type { ReportDocument } from "@/lib/report/document";

export type Recording = {
  version: 1;
  title: string;
  /** The exact chip texts the steps press, in order; each is also that turn's message. */
  press: { example: string; dataReply: string; runReply: string; option: string; reportReply: string };
  /** Five turns: the example, the data, the run, the what-if run, the report. Every run carries its chart series and no run id. */
  turns: DisplayTurn[];
  report: ReportDocument;
};

const Shape = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  press: z.strictObject({ example: z.string().min(1), dataReply: z.string().min(1), runReply: z.string().min(1), option: z.string().min(1), reportReply: z.string().min(1) }),
  turns: z.array(z.object({ id: z.string().min(1), userText: z.string().min(1), blocks: z.array(z.object({ kind: z.string() }).loose()), notice: z.null() })).length(5),
  report: z.object({ version: z.literal(1), title: z.string(), subtitle: z.string(), generatedAt: z.string(), language: z.string(), sections: z.array(z.object({ id: z.string(), heading: z.string(), blocks: z.array(z.unknown()) })).min(1) }),
});

function lastRun(turn: DisplayTurn) {
  const blocks = turn.blocks.filter((block): block is Extract<Block, { kind: "tool_result" }> => block.kind === "tool_result" && block.ok && block.payload.kind === "run");
  const payload = blocks.at(-1)?.payload;
  return payload && payload.kind === "run" ? payload : null;
}

/** The recording, or null when it is not one the tutorial's steps can play from start to finish. */
export function readRecording(raw: unknown): Recording | null {
  const parsed = Shape.safeParse(raw);
  if (!parsed.success) return null;
  const recording = raw as Recording;
  const { press, turns } = recording;
  const messages = [press.example, press.dataReply, press.runReply, press.option, press.reportReply];
  if (turns.some((turn, index) => turn.userText !== messages[index])) return null;
  if (!DRAFTS.understand.includes(press.example)) return null;
  if (!lastSuggestions(turns.slice(0, 1)).includes(press.dataReply)) return null;
  if (!lastSuggestions(turns.slice(0, 2)).includes(press.runReply)) return null;
  const firstRun = lastRun(turns[2]);
  if (!firstRun || !tryNextLabels(firstRun).includes(press.option)) return null;
  if (!lastSuggestions(turns.slice(0, 4)).includes(press.reportReply)) return null;

  const artifacts = deriveArtifacts(turns);
  if (!artifacts.config || artifacts.data.length === 0 || artifacts.runs.length !== 2 || !artifacts.report?.report_id) return null;
  if (deriveArtifacts(turns.slice(0, 2)).data.length === 0) return null; // the Data step comes before the first run
  if (artifacts.runs.some((run) => !run.payload.series || run.payload.run_id)) return null;
  return recording;
}

/** The recording kept in the repository. */
export function loadRecording(): Recording | null {
  return readRecording(recordingFile);
}
