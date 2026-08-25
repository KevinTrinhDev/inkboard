import { z } from "zod";

/**
 * Coordinates are normalized 0.0-1.0, never raw pixels, so the same board
 * renders correctly at any output resolution. See docs/ARCHITECTURE.md.
 */
export const NormalizedCoordinate = z.number().min(0).max(1);

export const BoardObjectBaseSchema = z.object({
  id: z.string().uuid(),
  x: NormalizedCoordinate,
  y: NormalizedCoordinate,
  createdAt: z.string().datetime(),
});

export type BoardObjectBase = z.infer<typeof BoardObjectBaseSchema>;
