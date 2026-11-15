# Model selection

The copilot uses free, open-weight models served locally by Ollama. This page records how the
defaults were chosen: shortlist from public research, then measure on this project's own
evaluation suite.

## Requirements

1. **Reliable native tool calling.** The model must pick the right one of 8 tools and fill
   arguments such as a 6-digit CCN, a year, and scenario percentages.
2. **Faithful copying of numbers.** The model must quote pre-formatted figures from tool output
   without changing them.
3. **Runs on a laptop.** About 4 GB or less at 4-bit quantization, so it fits in 8 GB of RAM or a
   modest GPU, with acceptable CPU latency.
4. **Permissive license** for a public portfolio project.

## Shortlist (November 2026)

Public guides and the Ollama library consistently point to the Qwen3 and Qwen3.5 families as the
default for local tool calling, with Llama 3.2 3B as the most widely supported small option, Gemma 4
as the strongest choice with more memory, and IBM Granite 4 as a compact enterprise-oriented
option. Sources:

- [Ollama tool-calling models, full list and best picks](https://localaimaster.com/blog/best-ollama-models-tool-calling)
- [Ollama function calling guide](https://localaimaster.com/blog/ollama-function-calling-tools)
- [Best local LLM for agents and tool calling](https://vdf.ai/blog/best-local-llm-for-agents-tool-calling/)
- [Best Ollama model for a tool-calling agent: benchmarks](https://webscraft.org/blog/yaku-model-ollama-obrati-dlya-agenta-z-tool-calling-porivnyannya-i-benchmarki?lang=en)
- [Best Ollama embedding models, MTEB, VRAM, and dimensions](https://www.morphllm.com/ollama-embedding-models)
- [Embedding models for RAG: which to run locally](https://insiderllm.com/guides/embedding-models-rag/)

Most published numbers in these guides come from vendors or unverified blogs, so every candidate
was re-tested on this project's workload.

| Model | Size (Q4) | Why shortlisted |
|---|---|---|
| `qwen3.5:4b` | 3.3 GB | Newest small Qwen; native tools; thinking can be disabled |
| `qwen3.5:2b` | 2.7 GB | Smallest current Qwen with tools |
| `qwen3:4b` | 2.5 GB | Previous generation, widely recommended |
| `llama3.2:3b` | 2.0 GB | Most widely supported small tool model |
| `granite4:3b` | 2.1 GB | IBM, Apache 2.0, built for enterprise tool use |
| `gemma4:e4b` | 6.6 GB | Gemma 4 edge model with native function calling |
| `ministral-3:3b` | 3.0 GB | Mistral's small edge model |

Embeddings: `embeddinggemma` (622 MB), `nomic-embed-text` (274 MB, most pulled), and
`qwen3-embedding:0.6b` (639 MB, top of MTEB for its size).

## Results

Hardware: 4 vCPU, 16 GB RAM, no GPU. Latencies are CPU-only and much lower on any GPU or Apple
Silicon; use them to compare models, not as absolute numbers.

<!-- MODEL_RESULTS_START -->
| Model | Tool selection | Answer accuracy | Grounded answers | Mean grounding | p50 latency (CPU) |
|---|---|---|---|---|---|
| offline analyst (no LLM)* | 100% | 100% | 100% | 100% | 0 s |
| `qwen3.5:4b` | 100% | 100% | 100% | 100% | 59 s |
| `qwen3.5:2b` | 92% | 75% | 92% | 99% | 22 s |
| `granite4:3b` | 92% | 75% | 58% | 74% | 49 s |
| `llama3.2:3b` | 75% | 67% | 100% | 100% | 28 s |

Agent suite: 12 questions covering lookups, peer comparison, opportunities, trends, what-if scenarios, rankings, and definitions. *Tool selection*: the expected tool was called. *Answer accuracy*: every expected figure (computed from the data) and keyword appears in the answer. *Grounded answers*: every number in the answer traces to tool output.

\* The offline analyst is a keyword router that was debugged on these questions, so its score is an upper bound, not a held-out result. The LLM prompts were not tuned on this set.

Retrieval suite: 25 questions over the KPI glossary, methodology, and CMS data dictionary.

| Retriever | hit@1 | hit@3 | MRR | Query latency |
|---|---|---|---|---|
| bm25 | 0.84 | 0.96 | 0.893 | 0 ms |
| dense:nomic-embed-text | 0.88 | 0.96 | 0.913 | 56 ms |
| hybrid:nomic-embed-text | 0.88 | 0.96 | 0.921 | 53 ms |
| dense:embeddinggemma | 0.88 | 0.96 | 0.930 | 51 ms |
| hybrid:embeddinggemma | 0.92 | 0.96 | 0.948 | 53 ms |
| dense:qwen3-embedding:0.6b | 0.92 | 0.96 | 0.950 | 99 ms |
| hybrid:qwen3-embedding:0.6b | 0.92 | 0.96 | 0.941 | 100 ms |
<!-- MODEL_RESULTS_END -->

## Findings

- **`qwen3.5:4b` is the default.** It was the only model to call the right tool, state every expected figure, and
  keep every number traceable to tool output on all 12 questions. It is also the slowest of the small models on a
  CPU, which matters little on a laptop GPU or Apple Silicon.
- **Smaller models fail in the arithmetic, not the routing.** `qwen3.5:2b` and `granite4:3b` usually picked the
  right tool but then restated or recomputed figures. `granite4:3b` invented a "$23,500" peer median that
  appeared nowhere in the data; the grounding check flagged it. This is the failure mode the verifier exists for.
- **`llama3.2:3b` is fast but skips tools.** It answered two scenario questions without calling the scenario
  tool, so it had no figures to quote. Its answers that did use tools were fully grounded.
- **`ministral-3:3b` declined to use tools** in a smoke test ("I don't have access to the tools needed"), so it
  is not recommended for this agent.
- **`qwen3:4b` is superseded by `qwen3.5:4b`.** In the smoke test it wrote its reasoning into the answer text
  even with thinking disabled, and took about 3x longer than `qwen3.5:4b` for the same tool call.
- **The offline analyst is a strong floor.** Because every figure comes from deterministic tools, even the
  keyword router answers these questions correctly. What the LLM adds is open-ended phrasing, follow-up
  context, and explanation, not the numbers.

Models that did not finish within the CPU time budget of the evaluation run are omitted from the table.

## Settings that matter

- **Thinking off.** Qwen3 and Qwen3.5 support a reasoning mode. It adds generated tokens, and so
  latency, to short tool-routing calls, so the client sends `think: false` for these families.
- **Temperature 0** for repeatable tool choice.
- **`num_ctx` 8192.** Tool outputs are kept compact (see `llm/tools.py`) so prompts stay near 3,000
  tokens.
- **One model loaded at a time** (`OLLAMA_MAX_LOADED_MODELS=1`) on 16 GB machines; loading Gemma 4
  next to another model ran out of memory.
- **Embedding prefixes.** Ollama's `/api/embed` does not add the query and document prefixes each
  embedding model was trained with, so `rag/index.py` adds them.
