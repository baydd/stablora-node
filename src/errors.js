/** An API, transport, pagination, or webhook verification failure. */
export class StabloraError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, requestId?: string, cause?: unknown }} [details]
   */
  constructor(message, { status, code, requestId, cause } = {}) {
    super(message, { cause });
    this.name = 'StabloraError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
