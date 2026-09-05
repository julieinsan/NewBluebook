"use client";

import { ConfirmDialog } from "@/app/(test)/_components/ConfirmDialog";
import { deleteAttempt as deleteAttemptRequest } from "@/app/(test)/test/[attemptId]/_lib/clientApi";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { practiceTestLabel } from "./positionLabel";

export interface DeleteAttemptButtonProps {
  attemptId: number;
  practiceTest: 1 | 2;
  className?: string;
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7" />
    </svg>
  );
}

export function DeleteAttemptButton({
  attemptId,
  practiceTest,
  className = "",
}: DeleteAttemptButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteAttemptRequest(attemptId);
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      console.error("Failed to delete attempt:", err);
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  const label = `${practiceTestLabel(practiceTest)} · Attempt #${attemptId}`;

  return (
    <>
      <button
        type="button"
        aria-label={`Delete ${label}`}
        className={`inline-flex items-center justify-center rounded-full p-2 text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-50 ${className}`}
        disabled={deleting}
        onClick={() => setConfirmOpen(true)}
      >
        <TrashIcon />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this attempt?"
        message={`Delete ${label}? This cannot be undone.`}
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        cancelLabel="Cancel"
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
