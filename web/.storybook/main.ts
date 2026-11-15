import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
  async viteFinal(cfg) {
    const { default: tailwind } = await import("@tailwindcss/vite");
    cfg.plugins = [...(cfg.plugins ?? []), tailwind()];
    return cfg;
  },
};

export default config;
