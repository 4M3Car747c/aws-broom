import type { Config } from "@react-router/dev/config";

export default {
  // Pure SPA: the Go server embeds build/client and serves index.html for every route.
  ssr: false,
} satisfies Config;
