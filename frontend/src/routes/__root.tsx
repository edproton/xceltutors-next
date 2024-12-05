import { AuthModal } from "@/components/auth/auth-modal";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import React from "react";

const TanStackRouterDevtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : React.lazy(() =>
        import("@tanstack/router-devtools").then((res) => ({
          default: res.TanStackRouterDevtools,
        }))
      );

const TanStackQueryDevtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : React.lazy(() =>
        import("@tanstack/react-query-devtools").then((res) => ({
          default: res.ReactQueryDevtools,
        }))
      );

export const Route = createRootRoute({
  component: () => (
    <>
      <Navbar />
      <hr />
      <Outlet />
      <TanStackRouterDevtools position="bottom-left" />
      <TanStackQueryDevtools position="top" buttonPosition="bottom-right" />
    </>
  ),
});

const navItems = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/expenses", label: "Expenses" },
  { to: "/create_expense", label: "Create Expense" },
];

export const Navbar = () => {
  return (
    <nav className="bg-background p-4 shadow-sm">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex gap-4">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{
                className: "font-bold text-primary",
              }}
              className="text-foreground hover:text-primary transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
        <AuthModal />
      </div>
    </nav>
  );
};
