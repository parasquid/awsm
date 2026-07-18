import { expect, it } from "vitest";
import { decodeCaptureJob } from "../../src/drivers/indexeddb/decode";

it("decodes only non-sensitive operational capture-job fields", () => {
  const decoded = decodeCaptureJob({
    version: 1,
    jobId: "00000000-0000-4000-8000-000000000001",
    commandId: "00000000-0000-4000-8000-000000000002",
    tabId: 7,
    state: "Running",
    stage: "MHTML",
    createdAt: "2026-07-16T17:00:00.000Z",
    updatedAt: "2026-07-16T17:00:01.000Z",
    url: "https://secret.test",
    pageBytes: new Uint8Array([1]),
  });
  expect(decoded).not.toHaveProperty("url");
  expect(decoded).not.toHaveProperty("pageBytes");
});

it("preserves the operational recent-capture dismissal flag", () => {
  expect(
    decodeCaptureJob({
      version: 1,
      jobId: "00000000-0000-4000-8000-000000000001",
      commandId: "00000000-0000-4000-8000-000000000002",
      tabId: 7,
      state: "Succeeded",
      stage: "Commit",
      createdAt: "2026-07-16T17:00:00.000Z",
      updatedAt: "2026-07-16T17:00:01.000Z",
      noticeDismissed: true,
    }),
  ).toMatchObject({ noticeDismissed: true });
});
