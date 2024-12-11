export interface LoginWithCredentialsInput {
  email: string;
  password: string;
}

export interface LoginWithCredentialsOutput {
  user: {
    id: number;
    name: string;
  };
  session: {
    id: string;
    expiresAt: Date;
  };
}
