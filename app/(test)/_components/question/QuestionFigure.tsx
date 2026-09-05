export interface QuestionFigureProps {
  src: string;
  alt?: string;
}

export function QuestionFigure({ src, alt = "Question figure" }: QuestionFigureProps) {
  return (
    <figure className="my-4">
      <img src={src} alt={alt} className="max-h-64 w-auto max-w-full object-contain" />
    </figure>
  );
}
