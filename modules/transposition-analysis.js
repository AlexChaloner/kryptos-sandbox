import { scanVigenerePeriods } from "./analysis.js";

let modelPromise = null;

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return Math.abs(a);
}

export async function loadNgramModels() {
  if (modelPromise) return modelPromise;
  modelPromise = fetch("quadgrams.json").then(async response => {
    if (!response.ok) throw new Error(`English n-gram model returned ${response.status}`);
    const data = await response.json();
    const models = { 4: { table: data.table, floor: data.floor } };
    const probabilities = Object.entries(data.table).map(([gram, logProbability]) => [gram, 10 ** logProbability]);
    for (const size of [2, 3]) {
      const totals = new Map();
      let total = 0;
      for (const [quadgram, probability] of probabilities) {
        for (let offset = 0; offset <= 4 - size; offset++) {
          const gram = quadgram.slice(offset, offset + size);
          totals.set(gram, (totals.get(gram) || 0) + probability);
          total += probability;
        }
      }
      const table = Object.fromEntries([...totals].map(([gram, probability]) => [gram, Math.log10(probability / total)]));
      const floor = Math.min(...Object.values(table)) - 1;
      models[size] = { table, floor };
    }
    return models;
  });
  return modelPromise;
}

export function modularRoute(source, step, start = 0) {
  const output = [];
  for (let count = 0, index = start; count < source.length; count++, index = (index + step) % source.length) {
    if (/[A-Z]/.test(source[index])) output.push(source[index]);
  }
  return output.join("");
}

export function ngramScore(sequence, size, model, cyclic = true) {
  if (sequence.length < size) return model.floor;
  const sample = cyclic ? sequence + sequence.slice(0, size - 1) : sequence;
  const windows = cyclic ? sequence.length : sequence.length - size + 1;
  let score = 0;
  for (let index = 0; index < windows; index++) score += model.table[sample.slice(index, index + size)] ?? model.floor;
  return score / windows;
}

export function standardizeCandidates(candidates, sizes) {
  if (!candidates.length) return candidates;
  for (const size of sizes) {
    const values = candidates.map(candidate => candidate.ngrams[size]);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) || 1;
    candidates.forEach(candidate => { candidate.ngramZ[size] = (candidate.ngrams[size] - mean) / deviation; });
  }
  candidates.forEach(candidate => {
    candidate.combinedNgramEvidence = sizes.reduce((sum, size) => sum + candidate.ngramZ[size], 0) / sizes.length;
  });
  const mean = candidates.reduce((sum, candidate) => sum + candidate.combinedNgramEvidence, 0) / candidates.length;
  const deviation = Math.sqrt(candidates.reduce((sum, candidate) => sum + (candidate.combinedNgramEvidence - mean) ** 2, 0) / candidates.length) || 1;
  candidates.forEach(candidate => { candidate.score = (candidate.combinedNgramEvidence - mean) / deviation; });
  return candidates;
}

export function scoreRouteCandidatesWithModels(candidates, models, options = {}) {
  const sizes = options.ngramSizes?.length ? options.ngramSizes : [2, 3, 4];
  const cyclic = Boolean(options.cyclic);
  const scored = candidates.map(candidate => ({ ...candidate, ngrams: {}, ngramZ: {} }));
  scored.forEach(candidate => {
    sizes.forEach(size => { candidate.ngrams[size] = ngramScore(candidate.route, size, models[size], cyclic); });
  });
  standardizeCandidates(scored, sizes);
  return scored;
}

export async function scoreRouteCandidates(candidates, options = {}) {
  const models = options.models || await loadNgramModels();
  const scored = scoreRouteCandidatesWithModels(candidates, models, options);
  return { candidates: scored, models, sizes: options.ngramSizes?.length ? options.ngramSizes : [2, 3, 4] };
}

export async function scanModularRoutes(sequence, options = {}) {
  const scoreMode = options.scoreMode || "ngrams";
  const sizes = options.ngramSizes?.length ? options.ngramSizes : [2, 3, 4];
  const models = scoreMode === "ngrams" ? await loadNgramModels() : null;
  const sources = [{ source: sequence, gap: false }];
  if (options.includeVirtualGap) sources.push({ source: `${sequence}?`, gap: true });
  const candidates = [];
  for (const specification of sources) {
    const modulus = specification.source.length;
    for (let step = 1; step < modulus; step++) {
      if (gcd(step, modulus) !== 1) continue;
      const route = modularRoute(specification.source, step);
      const candidate = { ...specification, modulus, step, start: 0, route, ngrams: {}, ngramZ: {} };
      if (scoreMode === "ngrams") {
        sizes.forEach(size => { candidate.ngrams[size] = ngramScore(route, size, models[size], true); });
      } else {
        const periods = scanVigenerePeriods(route, options.maximumKeyLength || 24, options.alphabetSize || 26);
        candidate.bestPeriod = periods.reduce((best, period) => period.significance.zScore > best.significance.zScore ? period : best, periods[0]);
        candidate.score = candidate.bestPeriod.significance.zScore;
      }
      candidates.push(candidate);
    }
  }
  if (scoreMode === "ngrams") standardizeCandidates(candidates, sizes);
  candidates.sort((a, b) => b.score - a.score);
  return { candidates, scoreMode, sizes, models };
}

export function bestNgramRouteOffset(candidate, models, sizes) {
  let best = null;
  const boundaryModelSize = Math.max(...sizes);
  for (let start = 0; start < candidate.modulus; start++) {
    const route = modularRoute(candidate.source, candidate.step, start);
    const scores = Object.fromEntries(sizes.map(size => [size, ngramScore(route, size, models[size], false)]));
    const score = scores[boundaryModelSize];
    if (!best || score > best.score) best = { start, route, scores, score };
  }
  return best;
}
