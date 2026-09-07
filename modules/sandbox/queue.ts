export class CommandQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly capacity: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal.reason ?? new Error('Sandbox command cancelled.'));
      };
      const grant = () => {
        signal.removeEventListener('abort', cancel);
        this.active += 1;
        resolve();
      };
      if (this.active < this.capacity) grant();
      else { this.waiting.push(grant); signal.addEventListener('abort', cancel, { once: true }); }
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}
