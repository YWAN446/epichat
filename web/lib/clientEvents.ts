import { z } from "zod";
import { CARD_KINDS, CHART_VIEWS, EXPORT_FORMATS, PANEL_SECTIONS, RATINGS, STAGES, SUGGESTION_SOURCES } from "./enums";

/**
 * What the browser may report about what a participant did. Every field is a
 * fixed word, an id, or a short device fact. An unknown field is refused, so
 * no typed text can be stored through this door.
 */
const id = z.uuid();
const sessionId = id.optional();
const device = {
  viewport: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
  language: z.string().max(16).regex(/^[A-Za-z0-9-]+$/).optional(),
  timezone: z.string().max(64).regex(/^[A-Za-z0-9_/+-]+$/).optional(),
};

const ClientEvent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("session_start"), ...device }),
  z.strictObject({ kind: z.literal("session_ping"), sessionId: id }),
  z.strictObject({ kind: z.literal("session_end"), sessionId: id }),
  z.strictObject({ kind: z.literal("conversation_opened"), sessionId, conversationId: id }),
  z.strictObject({ kind: z.literal("conversation_resumed"), sessionId, conversationId: id }),
  z.strictObject({ kind: z.literal("suggestion_used"), sessionId, conversationId: id, turnId: id.optional(), stage: z.enum(STAGES), source: z.enum(SUGGESTION_SOURCES).optional() }),
  z.strictObject({ kind: z.literal("card_expanded"), sessionId, conversationId: id, turnId: id, card: z.enum(CARD_KINDS) }),
  z.strictObject({ kind: z.literal("chart_view_changed"), sessionId, conversationId: id, turnId: id, view: z.enum(CHART_VIEWS) }),
  z.strictObject({ kind: z.literal("series_downloaded"), sessionId, conversationId: id, runId: id }),
  z.strictObject({ kind: z.literal("export"), sessionId, conversationId: id, format: z.enum(EXPORT_FORMATS) }),
  z.strictObject({ kind: z.literal("feedback_given"), sessionId, conversationId: id, turnId: id, rating: z.enum(RATINGS) }),
  z.strictObject({ kind: z.literal("scenario_panel_opened"), sessionId, conversationId: id, section: z.enum(PANEL_SECTIONS).optional() }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

const MAX_BODY_CHARS = 1000;

/** Read a reported action. Null when it is not one of the known shapes. */
export function readClientEvent(raw: string): ClientEvent | null {
  if (raw.length > MAX_BODY_CHARS) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ClientEvent.safeParse(json);
  return parsed.success ? parsed.data : null;
}
