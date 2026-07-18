import type { LibraryItemV1 } from "../../domain/contracts";
import { DomainValidationError } from "../../domain/errors";
import { canonicalRecord, literal, record, uuid } from "../../domain/validation";

export interface CollectionsMergedTopologyEventV1 {
  readonly eventId: string;
  readonly eventType: "CollectionsMerged";
  readonly destinationCollectionId: string;
  readonly sourceCollectionIds: readonly string[];
}

export interface CollectionMergeRevertedTopologyEventV1 {
  readonly eventId: string;
  readonly eventType: "CollectionMergeReverted";
  readonly mergeEventId: string;
}

export type CollectionTopologyEventV1 =
  | CollectionsMergedTopologyEventV1
  | CollectionMergeRevertedTopologyEventV1;

export interface LibraryCollectionStateV1 {
  readonly version: 1;
  readonly topologyEvents: readonly CollectionTopologyEventV1[];
}

export function decodeLibraryCollectionState(value: unknown): LibraryCollectionStateV1 {
  const input = canonicalRecord(value, "libraryCollectionState", ["version", "topologyEvents"]);
  if (!Array.isArray(input.topologyEvents)) {
    throw new DomainValidationError("libraryCollectionState.topologyEvents", "must be an array");
  }
  const topologyEvents = input.topologyEvents.map((value, index): CollectionTopologyEventV1 => {
    const event = record(value, `libraryCollectionState.topologyEvents.${String(index)}`);
    const eventId = uuid(event.eventId, `topologyEvent.${String(index)}.eventId`);
    if (event.eventType === "CollectionsMerged") {
      canonicalRecord(value, `libraryCollectionState.topologyEvents.${String(index)}`, [
        "eventId",
        "eventType",
        "destinationCollectionId",
        "sourceCollectionIds",
      ]);
      if (!Array.isArray(event.sourceCollectionIds)) {
        throw new DomainValidationError(
          `topologyEvent.${String(index)}.sourceCollectionIds`,
          "must be an array",
        );
      }
      return {
        eventId,
        eventType: "CollectionsMerged",
        destinationCollectionId: uuid(
          event.destinationCollectionId,
          `topologyEvent.${String(index)}.destinationCollectionId`,
        ),
        sourceCollectionIds: event.sourceCollectionIds.map((source, sourceIndex) =>
          uuid(source, `topologyEvent.${String(index)}.sourceCollectionIds.${String(sourceIndex)}`),
        ),
      };
    }
    if (event.eventType === "CollectionMergeReverted") {
      canonicalRecord(value, `libraryCollectionState.topologyEvents.${String(index)}`, [
        "eventId",
        "eventType",
        "mergeEventId",
      ]);
      return {
        eventId,
        eventType: "CollectionMergeReverted",
        mergeEventId: uuid(event.mergeEventId, `topologyEvent.${String(index)}.mergeEventId`),
      };
    }
    throw new DomainValidationError(`topologyEvent.${String(index)}.eventType`, "is unsupported");
  });
  return {
    version: literal(input.version, 1, "libraryCollectionState.version"),
    topologyEvents,
  };
}

export interface LibraryCollectionGroupV1 {
  readonly collectionId: string;
  readonly title: string;
  readonly originalUrl: string;
  readonly knownUrls: readonly string[];
  readonly latest: LibraryItemV1;
  readonly captures: readonly LibraryItemV1[];
}

export function normalizedPageKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function activeMerges(
  events: readonly CollectionTopologyEventV1[],
): readonly CollectionsMergedTopologyEventV1[] {
  const accepted = new Set<string>();
  const merges: CollectionsMergedTopologyEventV1[] = [];
  const reverted = new Set<string>();
  for (const event of events) {
    if (accepted.has(event.eventId)) continue;
    accepted.add(event.eventId);
    if (event.eventType === "CollectionMergeReverted") reverted.add(event.mergeEventId);
    else merges.push(event);
  }
  return merges.filter((event) => !reverted.has(event.eventId));
}

export function resolveCollectionId(
  collectionId: string,
  events: readonly CollectionTopologyEventV1[],
): string {
  const redirects = new Map<string, string>();
  for (const event of activeMerges(events)) {
    let destination = event.destinationCollectionId;
    const destinationSeen = new Set<string>();
    while (redirects.has(destination) && !destinationSeen.has(destination)) {
      destinationSeen.add(destination);
      destination = redirects.get(destination) ?? destination;
    }
    for (const sourceCollectionId of event.sourceCollectionIds) {
      let source = sourceCollectionId;
      const sourceSeen = new Set<string>();
      while (redirects.has(source) && !sourceSeen.has(source)) {
        sourceSeen.add(source);
        source = redirects.get(source) ?? source;
      }
      if (source !== destination) redirects.set(source, destination);
    }
  }
  let resolved = collectionId;
  const seen = new Set<string>();
  while (redirects.has(resolved) && !seen.has(resolved)) {
    seen.add(resolved);
    resolved = redirects.get(resolved) ?? resolved;
  }
  return resolved;
}

export function groupCollectionItems(
  items: readonly LibraryItemV1[],
  topology: readonly CollectionTopologyEventV1[],
  status: "Active" | "Deleted",
): readonly LibraryCollectionGroupV1[] {
  const grouped = new Map<string, LibraryItemV1[]>();
  for (const item of items) {
    if (item.status !== status) continue;
    const collectionId = resolveCollectionId(item.assignedCollectionId, topology);
    const captures = grouped.get(collectionId);
    if (captures === undefined) grouped.set(collectionId, [item]);
    else captures.push(item);
  }
  return [...grouped.entries()]
    .map(([collectionId, captures]) => {
      const sorted = captures.toSorted((left, right) =>
        right.capturedAt.localeCompare(left.capturedAt),
      );
      const latest = sorted[0];
      if (latest === undefined) throw new Error("A Collection cannot be empty.");
      const knownUrls: string[] = [];
      const seenUrls = new Set<string>();
      for (const capture of sorted) {
        if (seenUrls.has(capture.originalUrl)) continue;
        seenUrls.add(capture.originalUrl);
        knownUrls.push(capture.originalUrl);
      }
      return {
        collectionId,
        title: latest.title,
        originalUrl: latest.originalUrl,
        knownUrls,
        latest,
        captures: sorted,
      };
    })
    .toSorted(
      (left, right) =>
        right.latest.capturedAt.localeCompare(left.latest.capturedAt) ||
        left.collectionId.localeCompare(right.collectionId),
    );
}

export function selectCollectionForCapture(
  items: readonly LibraryItemV1[],
  topology: readonly CollectionTopologyEventV1[],
  originalUrl: string,
  createCollectionId: () => string,
): string {
  const candidateKey = normalizedPageKey(originalUrl);
  const matches = groupCollectionItems(items, topology, "Active").filter((group) =>
    group.captures.some((capture) => normalizedPageKey(capture.originalUrl) === candidateKey),
  );
  const match = matches.toSorted(
    (left, right) =>
      right.latest.capturedAt.localeCompare(left.latest.capturedAt) ||
      left.collectionId.localeCompare(right.collectionId),
  )[0];
  return match?.collectionId ?? createCollectionId();
}
