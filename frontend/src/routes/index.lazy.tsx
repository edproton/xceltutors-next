import { createLazyFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

export const Route = createLazyFileRoute("/")({
  component: RouteComponent,
});

const getTotalSpent = async () => {
  const response = await api.expenses["total-spent"].$get();
  if (!response.ok) {
    throw new Error("Failed to fetch total spent");
  }

  const json = await response.json();

  return json.total;
};

function RouteComponent() {
  const { isPending, error, data } = useQuery({
    queryKey: ["total-spent"],
    queryFn: getTotalSpent,
  });

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div className="container mx-auto p-4">
      <Card className="w-full max-w-sm mx-auto">
        <CardHeader>
          <CardTitle>Total Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-center">
            {isPending ? (
              <Loader2 className="h-6 w-6 animate-spin mx-auto" />
            ) : (
              `${data}`
            )}{" "}
          </p>
        </CardContent>
      </Card>
      <div className="mt-4 text-center">
        <Button>Refresh</Button>
      </div>
    </div>
  );
}
