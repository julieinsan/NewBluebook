"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/(test)/_components/ConfirmDialog";
import { MoreMenu } from "@/app/(test)/_components/MoreMenu";
import { postPause } from "@/app/(test)/test/[attemptId]/_lib/clientApi";

export interface PauseAndExitMenuProps {
  attemptId: number;
}

export function PauseAndExitMenu({ attemptId }: PauseAndExitMenuProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pausing, setPausing] = useState(false);

  const handleConfirm = async () => {
    if (pausing) return;
    setPausing(true);
    try {
      await postPause(attemptId);
      router.push("/");
    } catch (err) {
      console.error("Failed to pause attempt:", err);
      setPausing(false);
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <MoreMenu onPauseAndExit={() => setConfirmOpen(true)} />
      <ConfirmDialog
        open={confirmOpen}
        title="Pause this test?"
        message="Your answers are saved and the timer will stop. You can resume this attempt from the home screen when you are ready."
        confirmLabel={pausing ? "Pausing…" : "Pause and exit"}
        cancelLabel="Keep testing"
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
