"use client";

import { useQuery } from "@tanstack/react-query";

interface StudentsResponse {
  students: unknown[];
  isTeacher: boolean;
}

export function useIsTeacher() {
  const { data } = useQuery<StudentsResponse>({
    queryKey: ["students"],
    queryFn: async () => {
      const res = await fetch("/api/students");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 60_000,
  });
  return data?.isTeacher ?? false;
}
