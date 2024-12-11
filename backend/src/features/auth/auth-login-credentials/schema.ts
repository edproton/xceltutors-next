import { z } from "zod";

export const loginWithCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
