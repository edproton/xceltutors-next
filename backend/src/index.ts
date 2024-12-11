import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { renderTrpcPanel } from "trpc-panel";
import { authMiddleware } from "./middlewares/auth";
import { appRouter } from "./trpc/routers";
import { env } from "./config";

const app = new Hono();

app.use(authMiddleware);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, c) => ({
      user: c.var.user,
      hono: c,
    }),
  }),
);

// app.use("/panel", async (c) => {
//   const html = renderTrpcPanel(appRouter, {
//     url: "/trpc",
//   });
//   return c.html(html);
// });

export default {
  fetch: app.fetch,
  port: env.PORT,
};
