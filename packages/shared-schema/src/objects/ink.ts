import { z } from "zod";
import { BoardObjectBaseSchema, NormalizedCoordinate } from "./base.js";

/**
 * Raw Apple Pencil strokes. Maps directly to tldraw's native `draw` shape:
 * this is the path that has to feel instant, so it deliberately carries no
 * extra logic beyond the point/pressure samples.
 */
export const InkPointSchema = z.object({
  x: NormalizedCoordinate,
  y: NormalizedCoordinate,
  pressure: z.number().min(0).max(1),
});

export const InkObjectSchema = BoardObjectBaseSchema.extend({
  type: z.literal("ink"),
  points: z.array(InkPointSchema).min(1),
  color: z.string().default("#1a1a1a"),
  thickness: z.number().positive().default(2),
});

export type InkObject = z.infer<typeof InkObjectSchema>;
