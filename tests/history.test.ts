import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaseoAgentHandle } from "@getpaseo/client";
import { readHistory } from "../plugin/server/history";

function historyAgent(pages: unknown[]) {
  let next = 0;
  return {
    timeline: { refetch: async () => pages[next++] },
  } as unknown as PaseoAgentHandle;
}
const page = (seq: number, text: string) => ({
  epoch: "one",
  hasOlder: false,
  gap: false,
  staleCursor: false,
  error: null,
  entries: [{ seqStart: seq, item: { type: "assistant_message", text } }],
});

test("history pagination preserves order and excludes provider-only private state", async () => {
  const latest = {
    ...page(3, "new"),
    hasOlder: true,
    startCursor: { epoch: "one", seq: 3 },
  };
  const older = {
    ...page(1, "old"),
    entries: [
      ...page(1, "old").entries,
      { seqStart: 2, item: { type: "reasoning", text: "private reasoning" } },
    ],
  };
  const entries = await readHistory(historyAgent([latest, older]));
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ["old", "new"],
  );
});

test("history replacement, unavailable segments and provider read failures never produce partial forks", async () => {
  const latest = {
    ...page(3, "new"),
    hasOlder: true,
    startCursor: { epoch: "one", seq: 3 },
  };
  await assert.rejects(
    readHistory(historyAgent([latest, { ...page(1, "old"), epoch: "two" }])),
    /changed/,
  );
  await assert.rejects(
    readHistory(historyAgent([{ ...page(1, "old"), gap: true }])),
    /gap/,
  );
  await assert.rejects(
    readHistory(
      historyAgent([{ ...page(1, "old"), error: "Provider unavailable" }]),
    ),
    /Provider unavailable/,
  );
});
