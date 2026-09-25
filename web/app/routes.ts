import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("connect", "routes/connect.tsx"),
  route("history", "routes/history.tsx"),
  layout("routes/wizard/layout.tsx", [
    ...prefix("wizard", [
      index("routes/wizard/index.tsx"),
      route("regions", "routes/wizard/regions.tsx"),
      route("services", "routes/wizard/services.tsx"),
      route("scan/:jobId", "routes/wizard/scan.tsx"),
      route("review/:jobId", "routes/wizard/review.tsx"),
      route("clean/:jobId", "routes/wizard/clean.tsx"),
    ]),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
