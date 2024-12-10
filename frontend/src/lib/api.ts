import { hc } from "hono/client";
import { type ApiRoutes } from "@shared";

const client = hc<ApiRoutes>(import.meta.env.VITE_API_BASE_URL);

export const api = client.api.v1;
api.bookings.$get({
  query: {
    page: 1,
    limit: 10,
  },
}).then(async (res) => {
  const data = await res.json();
  // const data: any -> error 😪
});
