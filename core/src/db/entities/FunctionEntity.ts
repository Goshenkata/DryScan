import { Entity, PrimaryColumn, Column } from "typeorm";
import { FunctionInfo } from "../../types.js";

@Entity("functions")
export class FunctionEntity implements FunctionInfo {
  @PrimaryColumn("text")
  id!: string;

  @Column("text")
  name!: string;

  @Column("text")
  filePath!: string;

  @Column("integer")
  startLine!: number;

  @Column("integer")
  endLine!: number;

  @Column("text")
  code!: string;

  @Column("simple-json", { nullable: true })
  internalFunctions?: FunctionInfo[];

  @Column("simple-array", { nullable: true })
  embedding?: number[];
}
