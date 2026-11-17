/** Port of the BM25 retriever (src/hospital_ops_copilot/rag/index.py, keyword mode). */

import { pyRound } from "./pyfmt";

export interface Chunk {
  id: string;
  source: string;
  title: string;
  text: string;
  url: string;
}

const STOP = new Set(["a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "is", "are", "was", "what", "how", "does", "do", "which", "with", "by", "from", "as", "at", "it", "this", "that", "be"]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t));
}

export class DocIndex {
  private toks: string[][];
  private lens: number[];
  private avg: number;
  private tf: Map<string, number>[];
  private idf = new Map<string, number>();

  constructor(public chunks: Chunk[], private k1 = 1.5, private b = 0.75) {
    this.toks = chunks.map((c) => tokenize(`${c.title}\n${c.text}`));
    this.lens = this.toks.map((t) => t.length);
    this.avg = this.lens.length ? this.lens.reduce((a, x) => a + x, 0) / this.lens.length : 0;
    this.tf = this.toks.map((t) => {
      const m = new Map<string, number>();
      for (const w of t) m.set(w, (m.get(w) ?? 0) + 1);
      return m;
    });
    const df = new Map<string, number>();
    for (const t of this.toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
    const n = chunks.length;
    for (const [w, c] of df) this.idf.set(w, Math.log(1 + (n - c + 0.5) / (c + 0.5)));
  }

  scores(query: string): number[] {
    const q = tokenize(query);
    return this.tf.map((tf, i) => {
      let s = 0.0;
      const norm = this.k1 * (1 - this.b + (this.b * this.lens[i]) / (this.avg || 1));
      for (const w of q) {
        const f = tf.get(w);
        if (f) s += (this.idf.get(w)! * f * (this.k1 + 1)) / (f + norm);
      }
      return s;
    });
  }

  search(query: string, k = 3) {
    const scores = this.scores(query);
    const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]).slice(0, k);
    return order
      .filter((i) => scores[i] > 0)
      .map((i) => {
        const c = this.chunks[i];
        return { id: c.id, title: c.title, source: c.source, url: c.url, text: c.text, score: pyRound(scores[i], 4) };
      });
  }
}
