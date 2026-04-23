"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";

interface StudentsResponse {
  isTeacher: boolean;
  canBeTeacher: boolean;
  hasArchivedStudents?: boolean;
}

export function useIsTeacher() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const { data } = useQuery<StudentsResponse>({
    queryKey: ["students", userId],
    queryFn: async () => {
      const res = await fetch("/api/students");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 15_000,
    enabled: !!userId,
  });
  return data?.isTeacher || data?.canBeTeacher || data?.hasArchivedStudents || false;
}
