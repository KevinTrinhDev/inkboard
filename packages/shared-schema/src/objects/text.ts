import { z } from "zod";
import { BoardObjectBaseSchema } from "./base.js";

/**
 * Semantic, typed text: rendered via a handwriting-style variable font
 * (Playpen Sans, see ROADMAP M5), never stored as strokes/pixels. `lang` +
 * `content` are what a translation pass regenerates.
 */
export const TextObjectSchema = BoardObjectBaseSchema.extend({
  type: z.literal("text"),
  content: z.string().min(1),
  lang: z.string().min(2).default("en"),
  size: z.number().positive().default(24),
  style: z.string().default("classroom"),
});

export type TextObject = z.infer<typeof TextObjectSchema>;
