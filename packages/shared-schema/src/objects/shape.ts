import { z } from "zod";
import { BoardObjectBaseSchema, NormalizedCoordinate } from "./base.js";

/**
 * Basic geometric shapes, intended to be rendered with a hand-drawn/sketchy
 * style (e.g. Rough.js) rather than sterile vector edges.
 */
export const ShapeObjectSchema = BoardObjectBaseSchema.extend({
  type: z.literal("shape"),
  kind: z.enum(["rect", "ellipse", "line"]),
  x2: NormalizedCoordinate,
  y2: NormalizedCoordinate,
  color: z.string().default("#1a1a1a"),
});

export type ShapeObject = z.infer<typeof ShapeObjectSchema>;
