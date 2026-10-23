import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "agent/src/**/*.test.ts"],
    // Platform identity used by the unit tests. Real deployments set these in .env.
    env: {
      NCD_PLATFORM_DOMAINS: "acmepay.io",
      NCD_PLATFORM_NAME: "AcmePay",
      NCD_CNAME_TARGET: "domains.acmepay.io",
    },
  },
});
