import { z } from "zod";
import { BoardObjectBaseSchema, NormalizedCoordinate } from "./base.js";

export const ArrowObjectSchema = BoardObjectBaseSchema.extend({
  type: z.literal("arrow"),
  points: z
    .array(z.object({ x: NormalizedCoordinate, y: NormalizedCoordinate }))
    .min(2),
  color: z.string().default("#1a1a1a"),
});

export type ArrowObject = z.infer<typeof ArrowObjectSchema>;
