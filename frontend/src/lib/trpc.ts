import { createTRPCReact } from "@trpc/react-query";
import { type AppRouter } from "../../../backend/src/trpc/routers";

export const trpc = createTRPCReact<AppRouter>();
