export class LostLockError extends Error {
  constructor(type: string, key: string, instanceIdentifier: string) {
    super(
      `Lost ${type} lock (key: ${key}, instanceIdentifier: ${instanceIdentifier}). This means you have a configuration error.`
    );
    this.name = 'LostLockError';
  }
}
