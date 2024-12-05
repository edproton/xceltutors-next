"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { signIn } from "@/lib/auth";

function FieldInfo({ field }: { field: any }) {
  return (
    <>
      {field.state.meta.touchedErrors ? (
        <em className="text-red-500">{field.state.meta.touchedErrors}</em>
      ) : null}
    </>
  );
}

export function AuthModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signin");

  const signInForm = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      try {
        await signIn.email({
          email: value.email,
          password: value.password,
          callbackURL: "/dashboard",
        });
        setIsOpen(false);
      } catch (error) {
        console.error("Sign in error:", error);
      }
    },
  });

  const signUpForm = useForm({
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      try {
        if (value.password !== value.confirmPassword) {
          throw new Error("Passwords do not match");
        }
        await signIn.email({
          email: value.email,
          password: value.password,
          callbackURL: "/dashboard",
        });
        setIsOpen(false);
      } catch (error) {
        console.error("Sign up error:", error);
      }
    },
  });

  const handleGoogleSignIn = async () => {
    try {
      await signIn.social({
        provider: "google",
        callbackURL: window.location.origin + "/expenses",
      });
      setIsOpen(false);
    } catch (error) {
      console.error("Google sign in error:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Sign In</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Authentication</DialogTitle>
          <DialogDescription>
            Sign in or create an account to continue.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "signin" | "signup")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign In</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>
          <TabsContent value="signin">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                signInForm.handleSubmit();
              }}
            >
              <div className="space-y-4">
                <signInForm.Field
                  name="email"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Email</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="email"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                      <FieldInfo field={field} />
                    </div>
                  )}
                />
                <signInForm.Field
                  name="password"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Password</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                      <FieldInfo field={field} />
                    </div>
                  )}
                />
              </div>
              <div className="flex flex-col gap-4 mt-4">
                <signInForm.Subscribe
                  selector={(state) => [state.canSubmit, state.isSubmitting]}
                  children={([canSubmit, isSubmitting]) => (
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!canSubmit}
                    >
                      {isSubmitting ? "Signing In..." : "Sign In"}
                    </Button>
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogleSignIn}
                >
                  Sign In with Google
                </Button>
              </div>
            </form>
          </TabsContent>
          <TabsContent value="signup">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                signUpForm.handleSubmit();
              }}
            >
              <div className="space-y-4">
                <signUpForm.Field
                  name="email"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Email</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="email"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                      <FieldInfo field={field} />
                    </div>
                  )}
                />
                <signUpForm.Field
                  name="password"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Password</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                      <FieldInfo field={field} />
                    </div>
                  )}
                />
                <signUpForm.Field
                  name="confirmPassword"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Confirm Password</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                      <FieldInfo field={field} />
                    </div>
                  )}
                />
              </div>
              <div className="flex flex-col gap-4 mt-4">
                <signUpForm.Subscribe
                  selector={(state) => [state.canSubmit, state.isSubmitting]}
                  children={([canSubmit, isSubmitting]) => (
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!canSubmit}
                    >
                      {isSubmitting ? "Signing Up..." : "Sign Up"}
                    </Button>
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogleSignIn}
                >
                  Sign Up with Google
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4"
          onClick={() => setIsOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}
