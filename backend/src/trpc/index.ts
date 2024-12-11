// src/trpc/index.ts
import { initTRPC, TRPCError } from "@trpc/server";
import { Context } from "./types";
import { BaseError } from "@/errors/base.error";
import { TRPC_ERROR_CODES_BY_KEY } from "@trpc/server/rpc";
import { ZodError } from "zod";

function mapHttpStatusToTRPCCode(httpStatus: number) {
  switch (httpStatus) {
    case 400:
      return TRPC_ERROR_CODES_BY_KEY.BAD_REQUEST;
    case 401:
      return TRPC_ERROR_CODES_BY_KEY.UNAUTHORIZED;
    case 403:
      return TRPC_ERROR_CODES_BY_KEY.FORBIDDEN;
    case 404:
      return TRPC_ERROR_CODES_BY_KEY.NOT_FOUND;
    case 409:
      return TRPC_ERROR_CODES_BY_KEY.CONFLICT;
    default:
      return TRPC_ERROR_CODES_BY_KEY.INTERNAL_SERVER_ERROR;
  }
}

const t = initTRPC.context<Context>().create({
  errorFormatter(opts) {
    const { shape, error } = opts;

    if (error.cause instanceof BaseError) {
      return {
        message: error.cause.message,
        code: mapHttpStatusToTRPCCode(error.cause.code),
        data: {
          httpStatus: error.cause.code,
          code: mapHttpStatusToTRPCCode(error.cause.code),
        },
      };
    }

    return {
      ...shape,
      data: {
        ...shape.data,
        stack: undefined,
        zodError:
          error.code === "BAD_REQUEST" && error.cause instanceof ZodError
            ? error.cause.flatten()
            : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource",
    });
  }

  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

export const privateProcedure = t.procedure.use(isAuthed);
