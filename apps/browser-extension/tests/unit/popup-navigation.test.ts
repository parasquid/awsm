import { describe, expect, it, vi } from "vitest";
import { navigateFromPopup } from "../../src/ui/popup-navigation";

describe("popup navigation", () => {
  it("opens the destination before starting asynchronous Capture dismissal", () => {
    const order: string[] = [];
    const dismiss = vi.fn(() => {
      order.push("dismiss");
      return Promise.resolve();
    });

    navigateFromPopup({
      open: () => {
        order.push("open");
        return Promise.resolve();
      },
      dismiss,
    });

    expect(order).toEqual(["open", "dismiss"]);
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
