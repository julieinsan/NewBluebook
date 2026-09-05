import { expect, test } from "vitest";
import { splitRwStimulus } from "./splitRwStimulus";

test("splitRwStimulus separates passage from the final question paragraph", () => {
  const stimulus = `Text 1

Many teleost fish species are protogynous.

Text 2

Investigating protogyny in teleost fish, researchers placed wrasses in two tanks.

Based on the texts, which choice best explains the difference?`;

  const { passage, questionStem } = splitRwStimulus(stimulus);
  expect(passage).toContain("Many teleost fish");
  expect(passage).toContain("Investigating protogyny");
  expect(passage).not.toContain("Based on the texts");
  expect(questionStem).toBe("Based on the texts, which choice best explains the difference?");
});

test("splitRwStimulus returns the whole text when there is only one paragraph", () => {
  const text = "Which choice completes the text?";
  expect(splitRwStimulus(text)).toEqual({ passage: text, questionStem: text });
});
