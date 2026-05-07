import assert from "node:assert/strict";
import { test } from "node:test";

import Decimal from "decimal.js";

import {
  buildTeacherSplitCreateInput,
  mapTeacherRelationToCutInfo,
} from "../src/lib/commission-teacher-chain.ts";

test("teacher relation mapping preserves the relationship episode", () => {
  const relation = mapTeacherRelationToCutInfo({
    id: "rel_123",
    teacherId: "teacher_1",
    activationSequence: 3,
    depth: 1,
    teacherCut: new Decimal("20.00"),
  });

  assert.equal(relation.teacherId, "teacher_1");
  assert.equal(relation.relationshipId, "rel_123");
  assert.equal(relation.relationshipSequence, 3);
  assert.equal(relation.depth, 1);
  assert.equal(relation.teacherCutPercent.toString(), "20");
});

test("teacher split create input links the split to its teacher-student episode", () => {
  const input = buildTeacherSplitCreateInput({
    teacherCut: {
      teacherId: "teacher_1",
      relationshipId: "rel_123",
      relationshipSequence: 3,
      depth: 1,
      teacherCutPercent: new Decimal("20.00"),
    },
    cutAmount: new Decimal("15.00"),
    status: "EARNED",
    forfeitureReason: null,
    rewardfulCommissionId: "commission_1",
  });

  assert.deepEqual(input.teacherStudent, { connect: { id: "rel_123" } });
  assert.equal(input.teacherStudentSequence, 3);
  assert.deepEqual(input.recipient, { connect: { id: "teacher_1" } });
  assert.equal(input.cutPercent, 20);
  assert.equal(input.cutAmount, 15);
  assert.equal(input.idempotencyKey, "commission_1:teacher:teacher_1");
});
