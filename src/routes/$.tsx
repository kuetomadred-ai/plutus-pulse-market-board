import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$")({
  beforeLoad: ({ params }) => {
    if (params._splat === "index") {
      throw redirect({ to: "/", replace: true });
    }
    throw notFound();
  },
});