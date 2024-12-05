import { hc } from "hono/client";
import { type ApiRoutes } from "@shared";

const client = hc<ApiRoutes>(import.meta.env.VITE_API_BASE_URL);

export const api = client.api.v1;
