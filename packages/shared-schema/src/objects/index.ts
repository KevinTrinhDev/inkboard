import { z } from "zod";
import { TextObjectSchema } from "./text.js";
import { MathObjectSchema } from "./math.js";
import { InkObjectSchema } from "./ink.js";
import { ArrowObjectSchema } from "./arrow.js";
import { ShapeObjectSchema } from "./shape.js";

export * from "./base.js";
export * from "./text.js";
export * from "./math.js";
export * from "./ink.js";
export * from "./arrow.js";
export * from "./shape.js";

/** Discriminated union of every board object type, keyed on `type`. */
export const BoardObjectSchema = z.discriminatedUnion("type", [
  TextObjectSchema,
  MathObjectSchema,
  InkObjectSchema,
  ArrowObjectSchema,
  ShapeObjectSchema,
]);

export type BoardObject = z.infer<typeof BoardObjectSchema>;
