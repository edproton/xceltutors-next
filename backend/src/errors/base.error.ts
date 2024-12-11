import { ErrorCode } from "./error-codes";

export class BaseError extends Error {
  code: ErrorCode;

  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}
