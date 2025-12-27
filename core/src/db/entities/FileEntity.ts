import { Entity, PrimaryColumn, Column } from "typeorm";

/**
 * Represents a tracked source file in the repository.
 * Used to detect changes via checksum and mtime for incremental updates.
 */
@Entity("files")
export class FileEntity {
  /**
   * Relative path to the file from repository root.
   * Used as primary key for uniqueness.
   */
  @PrimaryColumn("text")
  filePath!: string;

  /**
   * MD5 checksum of file content.
   * Used to detect content changes.
   */
  @Column("text")
  checksum!: string;

  /**
   * Last modification time in milliseconds since epoch.
   * Used as fast sanity check before computing checksum.
   */
  @Column("integer")
  mtime!: number;
}
