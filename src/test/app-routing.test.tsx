import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("redirects the legacy /index preview to the trading home", async () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const route = router.matchRoutes("/index").at(-1);
    expect(route?.routeId).toBe("/$");
    const legacy = route ? router.routesById[route.routeId] : undefined;
    const beforeLoad = legacy?.options.beforeLoad;
    expect(typeof beforeLoad).toBe("function");
    if (typeof beforeLoad !== "function") throw new Error("Legacy redirect is missing");
    try {
      await (beforeLoad as (context: { params: { _splat: string } }) => unknown)({ params: { _splat: "index" } });
      throw new Error("Expected redirect");
    } catch (error) {
      expect(error).toMatchObject({ options: { to: "/", replace: true } });
    }
  });
});
