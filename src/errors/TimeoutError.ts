export class TimeoutError extends Error {
  constructor(type: string, key: string, instanceIdentifier: string) {
    super(
      `Timed out attempting to acquire ${type} lock (key: ${key}, instanceIdentifier: ${instanceIdentifier}).`
    );
    this.name = 'TimeoutError';
  }
}
