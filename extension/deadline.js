export function withTimeout(operation, milliseconds, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function scanDeadline(isActive, budget = 12000, commandLimit = 2500) {
  const expires = Date.now() + budget;
  let failure;
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
        if (error.message.endsWith('timed out')) failure = new Error('Tab scan timed out; other tabs will continue');
        throw error;
      }
    },
  };
}
