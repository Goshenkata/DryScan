import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  RelationId,
} from "typeorm";
import { IndexUnit, IndexUnitType } from "../../types";

@Entity("index_units")
export class IndexUnitEntity implements IndexUnit {
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

  @Column("text")
  unitType!: IndexUnitType;

  @ManyToOne(() => IndexUnitEntity, (unit) => unit.children, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "parent_id" })
  parent?: IndexUnitEntity | null;

  @RelationId((unit: IndexUnitEntity) => unit.parent)
  parentId?: string | null;

  @OneToMany(() => IndexUnitEntity, (unit) => unit.parent, { nullable: true })
  children?: IndexUnitEntity[];

  @Column("simple-array", { nullable: true })
  embedding?: number[] | null;
}
