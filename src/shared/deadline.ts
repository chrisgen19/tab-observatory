export function withTimeout<T>(operation: () => T | Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

export type ScanDeadline = {
  check(): void;
  run<T>(operation: () => T | Promise<T>, label: string, limit?: number): Promise<T>;
};

export function scanDeadline(isActive: () => boolean, budget = 12000, commandLimit = 2500): ScanDeadline {
  const expires = Date.now() + budget;
  let failure: Error | undefined;
  const check = () => {
    if (!isActive()) throw new Error('Monitoring stopped');
    if (failure) throw failure;
    if (Date.now() >= expires) throw new Error('Tab scan timed out; other tabs will continue');
  };
  return {
    check,
    async run(operation, label, limit = commandLimit) {
      check();
      try {
        const result = await withTimeout(operation, Math.max(1, Math.min(limit, expires - Date.now())), label);
        check();
        return result;
      } catch (error) {
        if ((error as Error).message.endsWith('timed out')) failure = new Error('Tab scan timed out; other tabs will continue');
        throw error;
      }
    },
  };
}
