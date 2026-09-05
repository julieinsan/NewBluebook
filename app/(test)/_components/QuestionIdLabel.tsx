export interface QuestionIdLabelProps {
  id: string;
}

export function QuestionIdLabel({ id }: QuestionIdLabelProps) {
  return (
    <span className="select-all font-mono text-xs text-foreground/50" data-testid="question-id-label">
      ID: {id}
    </span>
  );
}
