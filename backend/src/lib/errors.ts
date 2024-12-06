export class BookingError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
  }
}
