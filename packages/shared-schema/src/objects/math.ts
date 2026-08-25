import { z } from "zod";
import { BoardObjectBaseSchema } from "./base.js";

/**
 * Equations are stored as LaTeX and rendered via KaTeX, never in the
 * handwriting font — legibility (x vs 2 vs z) matters more than stylistic
 * consistency for math.
 */
export const MathObjectSchema = BoardObjectBaseSchema.extend({
  type: z.literal("math"),
  latex: z.string().min(1),
  size: z.number().positive().default(24),
});

export type MathObject = z.infer<typeof MathObjectSchema>;
