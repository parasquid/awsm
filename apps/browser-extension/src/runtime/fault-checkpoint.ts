export interface RuntimeFaultCheckpoint {
  reach(name: string, signal?: AbortSignal): Promise<void>;
}

export const noRuntimeFaultCheckpoint: RuntimeFaultCheckpoint = {
  reach: () => Promise.resolve(),
};
