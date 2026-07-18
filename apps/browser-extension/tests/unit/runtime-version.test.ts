import { describe, expect, it } from "vitest";

import { RUNTIME_VERSION } from "../../src/runtime/version";

describe("Runtime version", () => {
  it("exposes the first versioned Runtime contract", () => {
    expect(RUNTIME_VERSION).toEqual({
      api: 1,
      captureProfile: "ChromeWebPage-v1",
    });
  });
});
