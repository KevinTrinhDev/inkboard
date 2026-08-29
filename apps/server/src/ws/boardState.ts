import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  applyRecordsDiff,
  SyncRecordSchema,
  type RecordsDiff,
  type SyncRecord,
} from "@inkboard/shared-schema";
import { z } from "zod";

const PersistedBoardSchema = z.object({
  savedAt: z.string(),
  records: z.record(z.string(), SyncRecordSchema),
  schema: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The authoritative board, so a device that connects late (or reconnects
 * after the iPad slept) receives current state instead of an empty canvas.
 *
 * Held in memory and mirrored to one JSON file. This is a single-user LAN
 * server, so a file is the right amount of machinery: no database, no schema
 * migrations, and the file is readable if anything ever needs debugging.
 */
export class BoardState {
  private records: Record<string, SyncRecord> = {};
  private schema: Record<string, unknown> | undefined;
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly filePath: string,
    /**
     * Coalescing window for disk writes. Ink generates a high rate of small
     * diffs, and writing the whole board per stroke would peg the disk for no
     * benefit, so writes are batched.
     */
    private readonly saveDebounceMs = 1000,
  ) {}

  /** Loads persisted state, tolerating a missing or corrupt file. */
  load(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const parsed = PersistedBoardSchema.safeParse(
        JSON.parse(readFileSync(this.filePath, "utf8")),
      );
      if (parsed.success) {
        this.records = parsed.data.records;
        this.schema = parsed.data.schema;
      }
      // A corrupt file is deliberately non-fatal: starting with an empty
      // board beats refusing to boot, and the file is rewritten on the next
      // save anyway.
    } catch {
      this.records = {};
    }
  }

  snapshot(): Record<string, SyncRecord> {
    return this.records;
  }

  /** tldraw's serialized schema, kept opaque so board data stays migratable. */
  serializedSchema(): Record<string, unknown> | undefined {
    return this.schema;
  }

  isEmpty(): boolean {
    return Object.keys(this.records).length === 0;
  }

  applyDiff(diff: RecordsDiff): void {
    this.records = applyRecordsDiff(this.records, diff);
    this.scheduleSave();
  }

  replaceAll(
    records: Record<string, SyncRecord>,
    schema?: Record<string, unknown>,
  ): void {
    this.records = { ...records };
    if (schema) this.schema = schema;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, this.saveDebounceMs);

    // Never hold the process open just to flush the board.
    this.saveTimer.unref?.();
  }

  /** Writes immediately if there are unsaved changes. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const payload = JSON.stringify({
      savedAt: new Date().toISOString(),
      records: this.records,
      schema: this.schema,
    });

    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      // Write-then-rename: a crash mid-write leaves the previous good file
      // intact rather than a truncated one that fails to parse on boot.
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, payload, "utf8");
      renameSync(tmp, this.filePath);
    } catch {
      // Losing a board save must never take the server down mid-lesson. The
      // in-memory board stays authoritative for connected devices.
      this.dirty = true;
    }
  }

  /** Cancels the pending timer and writes synchronously. For shutdown/tests. */
  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.flush();
  }
}

export function defaultBoardStatePath(recordingsDir: string): string {
  return join(recordingsDir, "board-state.json");
}
