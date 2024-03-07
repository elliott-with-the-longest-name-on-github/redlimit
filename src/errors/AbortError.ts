export class AbortError extends Error {
  constructor() {
    super('Procedure aborted.');
    this.name = 'AbortError';
  }
}
