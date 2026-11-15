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
Pending.
<!-- MODEL_RESULTS_END -->

## Settings that matter

- **Thinking off.** Qwen3 and Qwen3.5 support a reasoning mode. For short tool-routing tasks it
  multiplied latency without changing tool choice, so the client sends `think: false` for these
  families. With thinking on, Qwen3 4B also leaked reasoning text into the answer.
- **Temperature 0** for repeatable tool choice.
- **`num_ctx` 8192.** Tool outputs are kept compact (see `llm/tools.py`) so prompts stay near 3,000
  tokens.
- **One model loaded at a time** (`OLLAMA_MAX_LOADED_MODELS=1`) on 16 GB machines; loading Gemma 4
  next to another model ran out of memory.
- **Embedding prefixes.** Ollama's `/api/embed` does not add the query and document prefixes each
  embedding model was trained with, so `rag/index.py` adds them.
