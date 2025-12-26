import { Entity, PrimaryColumn, Column, ManyToMany, JoinTable } from "typeorm";
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

  @ManyToMany(() => FunctionEntity, { nullable: true, cascade: false })
  @JoinTable({
    name: "function_dependencies",
    joinColumn: { name: "function_id", referencedColumnName: "id" },
    inverseJoinColumn: { name: "depends_on_id", referencedColumnName: "id" }
  })
  internalFunctions?: FunctionEntity[];

  @Column("simple-array", { nullable: true })
  embedding?: number[];
}
