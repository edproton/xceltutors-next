export class BookingValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BookingValidationError";
  }
}
