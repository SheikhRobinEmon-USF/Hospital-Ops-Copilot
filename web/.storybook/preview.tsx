import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { domMax, LazyMotion } from "motion/react";

import { TooltipProvider } from "../src/components/ui/tooltip";
import "../src/app/globals.css";

const queryClient = new QueryClient();

const withProviders: Decorator = (Story, ctx) => {
  const dark = ctx.globals.theme !== "light";
  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-[var(--background)] p-6 font-sans text-[var(--foreground)]">
        <QueryClientProvider client={queryClient}>
          <LazyMotion features={domMax}>
            <TooltipProvider delayDuration={150}>
              <Story />
            </TooltipProvider>
          </LazyMotion>
        </QueryClientProvider>
      </div>
    </div>
  );
};

const preview: Preview = {
  decorators: [withProviders],
  globalTypes: {
    theme: {
      description: "Color theme",
      toolbar: { title: "Theme", icon: "mirror", items: ["dark", "light"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "dark" },
  parameters: { layout: "fullscreen", controls: { expanded: true } },
};

export default preview;
