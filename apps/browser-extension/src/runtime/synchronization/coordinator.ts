export interface SynchronizationWakeDependencies {
  readonly execute: (signal: AbortSignal) => Promise<void>;
  readonly preparePassivePoll: () => Promise<void>;
  readonly prepareInteractiveWake: () => Promise<void>;
  readonly prepareMutation: (vaultId: string) => Promise<void>;
  readonly prepareCableWake: (latestCursor: number) => Promise<void>;
}

export class SynchronizationCoordinator {
  private active: Promise<void> | undefined;
  private activeController: AbortController | undefined;
  private suspended = false;
  private continueRequested = false;
  private passivePollRequested = false;
  private interactiveWakeRequested = false;
  private readonly mutationVaultIds = new Set<string>();
  private latestCableCursor: number | undefined;

  constructor(private readonly dependencies: SynchronizationWakeDependencies) {}

  continue(): Promise<void> {
    if (this.active !== undefined) return this.active;
    this.continueRequested = true;
    return this.start();
  }

  passivePoll(): Promise<void> {
    this.passivePollRequested = true;
    return this.start();
  }

  interactiveWake(): Promise<void> {
    this.interactiveWakeRequested = true;
    return this.start();
  }

  mutation(vaultId: string): Promise<void> {
    this.mutationVaultIds.add(vaultId);
    return this.start();
  }

  cable(latestCursor: number): Promise<void> {
    this.latestCableCursor = Math.max(this.latestCableCursor ?? 0, latestCursor);
    return this.start();
  }

  async suspend(): Promise<() => void> {
    this.suspended = true;
    await this.active;
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.suspended = false;
      if (this.hasPendingWork()) void this.start();
    };
  }

  async replaceContext<T>(operation: () => Promise<T>): Promise<T> {
    this.suspended = true;
    this.clearPendingWork();
    this.activeController?.abort();
    await this.active?.catch(() => undefined);
    try {
      return await operation();
    } finally {
      this.suspended = false;
    }
  }

  private start(): Promise<void> {
    if (this.suspended) return Promise.resolve();
    if (this.active !== undefined) return this.active;
    const controller = new AbortController();
    this.activeController = controller;
    const run = this.drain(controller.signal).finally(() => {
      if (this.active === run) this.active = undefined;
      if (this.activeController === controller) this.activeController = undefined;
      if (!this.suspended && this.hasPendingWork()) void this.start();
    });
    this.active = run;
    return run;
  }

  private clearPendingWork(): void {
    this.continueRequested = false;
    this.passivePollRequested = false;
    this.interactiveWakeRequested = false;
    this.mutationVaultIds.clear();
    this.latestCableCursor = undefined;
  }

  private hasPendingWork(): boolean {
    return (
      this.continueRequested ||
      this.passivePollRequested ||
      this.interactiveWakeRequested ||
      this.mutationVaultIds.size > 0 ||
      this.latestCableCursor !== undefined
    );
  }

  private async drain(signal: AbortSignal): Promise<void> {
    while (!this.suspended && !signal.aborted && this.hasPendingWork()) {
      const passivePoll = this.passivePollRequested;
      const interactiveWake = this.interactiveWakeRequested;
      const mutationVaultIds = [...this.mutationVaultIds];
      const latestCableCursor = this.latestCableCursor;
      this.continueRequested = false;
      this.passivePollRequested = false;
      this.interactiveWakeRequested = false;
      this.mutationVaultIds.clear();
      this.latestCableCursor = undefined;

      if (interactiveWake) await this.dependencies.prepareInteractiveWake();
      for (const vaultId of mutationVaultIds) await this.dependencies.prepareMutation(vaultId);
      if (latestCableCursor !== undefined)
        await this.dependencies.prepareCableWake(latestCableCursor);
      if (passivePoll) await this.dependencies.preparePassivePoll();
      await this.dependencies.execute(signal);
    }
  }
}
