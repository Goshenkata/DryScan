import { Entity, PrimaryColumn, Column } from "typeorm";

/**
 * Persisted LLM classification verdict for a duplicate candidate pair.
 * Used to skip re-classification on subsequent runs when neither file has changed.
 */
@Entity("llm_verdicts")
export class LLMVerdictEntity {
  /** Stable, order-independent key: sorted(left.id, right.id).join("::") */
  @PrimaryColumn("text")
  pairKey!: string;

  /** "yes" = confirmed duplicate, "no" = false positive */
  @Column("text")
  verdict!: "yes" | "no";

  /** File path of the left unit — used to invalidate when the file becomes dirty */
  @Column("text")
  leftFilePath!: string;

  /** File path of the right unit — used to invalidate when the file becomes dirty */
  @Column("text")
  rightFilePath!: string;

  /** Unix timestamp (ms) when the verdict was recorded */
  @Column("integer")
  createdAt!: number;
}
