"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postResume } from "@/app/(test)/test/[attemptId]/_lib/clientApi";

export interface ResumeButtonProps {
  attemptId: number;
  className?: string;
  children: React.ReactNode;
}

export function ResumeButton({ attemptId, className, children }: ResumeButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { next } = await postResume(attemptId);
      router.push(next);
    } catch (err) {
      console.error("Failed to resume attempt:", err);
      setLoading(false);
    }
  };

  return (
    <button type="button" className={className} disabled={loading} onClick={() => void handleClick()}>
      {loading ? "Resuming…" : children}
    </button>
  );
}
