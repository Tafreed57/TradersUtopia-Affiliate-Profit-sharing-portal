export interface CompleteRemovalRelationship {
  id: string;
  depth: number;
}

export interface CompleteRemovalIndirectRelationship {
  id: string;
  studentId: string;
}

export interface CompleteRemovalPlan {
  relationshipIdsToDeactivate: string[];
  preservedIndirectRelationshipIds: string[];
}

export function planCompleteTeacherStudentRemoval({
  relationship,
  activeIndirectRelationships,
}: {
  relationship: CompleteRemovalRelationship;
  activeIndirectRelationships: CompleteRemovalIndirectRelationship[];
}): CompleteRemovalPlan {
  if (relationship.depth !== 1) {
    throw new Error("Only direct student relationships can be completely removed");
  }

  return {
    relationshipIdsToDeactivate: [relationship.id],
    preservedIndirectRelationshipIds: activeIndirectRelationships.map(
      (item) => item.id
    ),
  };
}

