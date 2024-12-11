import { BaseError } from "./base.error";

export class AuthError extends BaseError {
  constructor(message: string) {
    super(message, 401);
  }
}
