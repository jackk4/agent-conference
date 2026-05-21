import test from "node:test";
import assert from "node:assert/strict";
import { debateTurn, extractAgree, primer, stripThinkTags } from "../src/prompts";

test("extractAgree returns the agreement text when present", () => {
  assert.equal(
    extractAgree("I can support this. [AGREE: Ship the CI checks.]"),
    "Ship the CI checks."
  );
});

test("extractAgree treats a bare agreement marker as agreed", () => {
  assert.equal(extractAgree("Looks good to me. [AGREE]"), "agreed");
});

test("extractAgree ignores text without an agreement marker", () => {
  assert.equal(extractAgree("I still have concerns."), null);
});

test("stripThinkTags removes complete and dangling think tags", () => {
  assert.equal(
    stripThinkTags("Visible\n\n<think>hidden reasoning</think>\n\n</think>\n\nAnswer"),
    "Visible\n\nAnswer"
  );
});

test("primer includes agent role, peers, cwd, and question", () => {
  const prompt = primer(
    { name: "Backend", cwd: "./src", role: "API design" },
    [{ name: "Frontend" }, { name: "Backend", cwd: "./src", role: "API design" }],
    "How should CI run?"
  );

  assert.match(prompt, /You are Backend/);
  assert.match(prompt, /alongside: Frontend/);
  assert.match(prompt, /API design/);
  assert.match(prompt, /Your codebase context:/);
  assert.match(prompt, /Original question: "How should CI run\?"/);
});

test("debateTurn includes transcript and final agreement instruction", () => {
  const prompt = debateTurn({ name: "QA" }, "[Frontend]\nWe need tests.");

  assert.match(prompt, /\[Frontend\]\nWe need tests\./);
  assert.match(prompt, /Your turn, QA/);
  assert.match(prompt, /\[AGREE: <one-sentence final answer>\]/);
});
