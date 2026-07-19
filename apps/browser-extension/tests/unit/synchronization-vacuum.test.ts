import { describe, expect, it, vi } from "vitest";
import { SynchronizedVacuumActivator } from "../../src/runtime/synchronization/vacuum";

describe("synchronized Vault Vacuum", () => {
  it("activates the fenced server successor before committing local authority", async () => {
    const vaultId = "01900000-0000-7000-8000-000000000501";
    const predecessor = "01900000-0000-7000-8000-000000000502";
    const successor = "01900000-0000-7000-8000-000000000503";
    const retained = "01900000-0000-7000-8000-000000000504";
    const order: string[] = [];
    const request = vi.fn(async (method: string, path: string) => {
      order.push(`${method} ${path}`);
      if (path.endsWith("/generation-candidates")) {
        return {
          status: 201,
          body: {
            upload: {
              uploadId: "01900000-0000-7000-8000-000000000505",
              partSizeBytes: 3,
              receivedParts: [],
            },
            ticket: { url: "/parts/{partNumber}" },
          },
        };
      }
      if (path.endsWith("/activate"))
        return {
          status: 200,
          body: { generationId: successor, generationNumber: 1, headCursor: 8 },
        };
      return { status: method === "PUT" ? 204 : 200, body: {} };
    });
    const commitLocal = vi.fn(async () => {
      order.push("LOCAL COMMIT");
    });
    const activator = new SynchronizedVacuumActivator(
      vaultId,
      0,
      7,
      {
        listStoredObjects: async () => [
          {
            version: 1,
            objectId: retained,
            objectType: "BundleDescriptor",
            envelopeBytes: new Uint8Array([9]),
          },
        ],
        listStoredEvents: async () => [],
      },
      { request, putTransfer: async () => undefined },
      commitLocal,
      {
        persistCandidate: async () => {
          order.push("PERSIST CANDIDATE");
        },
        markRemoteActivated: async () => {
          order.push("MARK REMOTE ACTIVATED");
        },
      },
    );

    await activator.activate({
      jobId: crypto.randomUUID(),
      objectIds: [],
      eventIds: [],
      eventsToAdd: [],
      bundleIds: [],
      expectedGenerationId: predecessor,
      generation: {
        version: 1,
        generationId: successor,
        generationNumber: 1,
        predecessorGenerationId: predecessor,
        envelopeBytes: new Uint8Array([1, 2, 3]),
      },
      head: {
        version: 1,
        vaultId,
        generationId: successor,
        generationNumber: 1,
        appendedObjectIds: [],
        appendedEventIds: [],
      },
      deletedArtifactObjectIds: [],
    });

    expect(order.findIndex((entry) => entry.endsWith("/activate"))).toBeLessThan(
      order.indexOf("LOCAL COMMIT"),
    );
    expect(order[0]).toBe("PERSIST CANDIDATE");
    expect(order.indexOf("MARK REMOTE ACTIVATED")).toBeGreaterThan(
      order.findIndex((entry) => entry.endsWith("/activate")),
    );
    expect(order.indexOf("MARK REMOTE ACTIVATED")).toBeLessThan(order.indexOf("LOCAL COMMIT"));
    expect(commitLocal).toHaveBeenCalledWith(
      expect.objectContaining({ expectedGenerationId: predecessor }),
      8,
    );
  });
});
