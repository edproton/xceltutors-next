import { loginWithCredentialsSchema } from "@/features/auth/auth-login-credentials/schema";
import { publicProcedure, router } from "..";
import { LoginWithCredentialsCommand } from "@/features/auth/auth-login-credentials";

export const authRouter = router({
  login: publicProcedure
    .input(loginWithCredentialsSchema)
    .mutation(async ({ input }) => {
      const result = await LoginWithCredentialsCommand.execute(input);

      return result;
    }),
});
