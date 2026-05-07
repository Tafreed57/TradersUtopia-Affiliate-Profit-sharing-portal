import type { CommissionStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";

type Decimalish = { toString(): string };

export interface TeacherRelationRecord {
  id: string;
  teacherId: string;
  activationSequence: number;
  teacherCut: Decimalish;
  depth: number;
}

export interface TeacherCutInfo {
  teacherId: string;
  relationshipId: string;
  relationshipSequence: number;
  teacherCutPercent: Decimal;
  depth: number;
}

export function mapTeacherRelationToCutInfo(
  relation: TeacherRelationRecord
): TeacherCutInfo {
  return {
    teacherId: relation.teacherId,
    relationshipId: relation.id,
    relationshipSequence: relation.activationSequence,
    teacherCutPercent: new Decimal(relation.teacherCut.toString()),
    depth: relation.depth,
  };
}

export function buildTeacherSplitCreateInput({
  teacherCut,
  cutAmount,
  status,
  forfeitureReason,
  rewardfulCommissionId,
}: {
  teacherCut: TeacherCutInfo;
  cutAmount: Decimal;
  status: CommissionStatus;
  forfeitureReason: string | null;
  rewardfulCommissionId: string;
}): Prisma.CommissionSplitCreateWithoutEventInput {
  return {
    recipient: { connect: { id: teacherCut.teacherId } },
    teacherStudent: { connect: { id: teacherCut.relationshipId } },
    teacherStudentSequence: teacherCut.relationshipSequence,
    role: "TEACHER",
    depth: teacherCut.depth,
    cutPercent: teacherCut.teacherCutPercent.toDecimalPlaces(2).toNumber(),
    cutAmount: cutAmount.toDecimalPlaces(2).toNumber(),
    status,
    forfeitedToCeo: false,
    forfeitureReason,
    idempotencyKey: `${rewardfulCommissionId}:teacher:${teacherCut.teacherId}`,
  };
}
