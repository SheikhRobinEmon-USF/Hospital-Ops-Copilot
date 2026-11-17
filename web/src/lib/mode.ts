"use client";

import { useHealth } from "./queries";

export const REPO_URL = "https://github.com/SheikhRobinEmon-USF/Hospital-Ops-Copilot";
export const RUN_LOCALLY_URL = `${REPO_URL}#option-b-local-recommended-on-a-mac-ollama-uses-the-gpu`;

/**
 * Which engine answers copilot questions. Shown wherever the copilot appears so users always know
 * whether they are reading an AI model or the rule-based offline analyst.
 *
 * - "ai": a local language model through Ollama.
 * - "demo": the public demo; the server is configured for the offline analyst on purpose.
 * - "offline": running locally, but Ollama is not reachable.
 */
export type CopilotMode = "ai" | "demo" | "offline" | "unknown";

export function useCopilotMode(): { mode: CopilotMode; model: string | null } {
  const { data } = useHealth();
  if (!data) return { mode: "unknown", model: null };
  if (data.ollama_available) return { mode: "ai", model: data.chat_model };
  if (data.llm_backend === "offline") return { mode: "demo", model: null };
  return { mode: "offline", model: null };
}

export const MODE_COPY: Record<CopilotMode, { short: string; long: string }> = {
  ai: {
    short: "AI model",
    long: "Answers are written by a local language model running on Ollama. It calls the analytics tools for every figure, and each number is checked against the data.",
  },
  demo: {
    short: "Offline analyst · no AI model",
    long:
      "This public demo answers with the offline analyst: a rule-based engine that routes your question to the same analytics tools and fills in a fixed template. No language model is involved, so answers are instant and every figure is exact, but wording is not adaptive. Run the project locally with Ollama for AI-written answers (qwen3.5:4b).",
  },
  offline: {
    short: "Offline analyst · no AI model",
    long: "Ollama is not running, so the rule-based offline analyst is answering: same tools and figures, templated wording. Open the Ollama app and reload for AI answers.",
  },
  unknown: { short: "Connecting...", long: "Checking which engine is available." },
};
