/**
 * R&W questions store the passage and question stem together in `stimulus_text`.
 * The two-pane layout needs them split: passage left, stem + choices right.
 */
export function splitRwStimulus(stimulusText: string): { passage: string; questionStem: string } {
  const trimmed = stimulusText.trim();
  if (!trimmed) {
    return { passage: "", questionStem: "" };
  }

  const parts = trimmed.split(/\n\n+/);
  if (parts.length <= 1) {
    return { passage: trimmed, questionStem: trimmed };
  }

  const questionStem = parts[parts.length - 1]!;
  const passage = parts.slice(0, -1).join("\n\n");
  return { passage, questionStem };
}
