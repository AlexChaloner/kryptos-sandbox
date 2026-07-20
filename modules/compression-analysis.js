const LOG2_26 = Math.log2(26);
const modelCache = new WeakMap();

function conditionalModel(quadgramModel) {
  if (modelCache.has(quadgramModel)) return modelCache.get(quadgramModel);
  const floorProbability = 10 ** quadgramModel.floor;
  const contexts = new Map();
  for (const [gram, logProbability] of Object.entries(quadgramModel.table)) {
    const prefix = gram.slice(0, 3);
    let context = contexts.get(prefix);
    if (!context) {
      context = { total: 26 * floorProbability, known: new Map() };
      contexts.set(prefix, context);
    }
    const probability = 10 ** logProbability;
    context.total += probability - floorProbability;
    context.known.set(gram[3], probability);
  }
  const model = { contexts, floorProbability };
  modelCache.set(quadgramModel, model);
  return model;
}

export function conditionalEnglishCodeLength(sequence, quadgramModel) {
  const text = sequence.replace(/[^A-Z]/g, "");
  if (!text.length) return { bits: 0, bitsPerCharacter: 0 };
  const model = conditionalModel(quadgramModel);
  let bits = Math.min(3, text.length) * LOG2_26;
  for (let index = 3; index < text.length; index++) {
    const context = model.contexts.get(text.slice(index - 3, index));
    if (!context) {
      bits += LOG2_26;
      continue;
    }
    const probability = context.known.get(text[index]) || model.floorProbability;
    bits -= Math.log2(probability / context.total);
  }
  return { bits, bitsPerCharacter: bits / text.length };
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(initialSeed) {
  let seed = initialSeed || 0x9e3779b9;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function randomText(length, random) {
  let text = "";
  for (let index = 0; index < length; index++) text += String.fromCharCode(65 + Math.floor(random() * 26));
  return text;
}

function shuffledText(source, random) {
  const letters = [...source];
  for (let index = letters.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
  }
  return letters.join("");
}

function summarizeNull(values, observed) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const standardDeviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1));
  const hits = values.filter(value => value <= observed).length;
  return {
    mean,
    standardDeviation,
    zScore: standardDeviation ? (mean - observed) / standardDeviation : 0,
    pValue: (hits + 1) / (values.length + 1),
    hits,
    trials: values.length,
  };
}

export function compressionTrialCount(length) {
  return Math.max(399, Math.min(1199, Math.floor(500000 / Math.max(1, length))));
}

export function calibrateEnglishCompression(sequence, quadgramModel, options = {}) {
  const text = sequence.replace(/[^A-Z]/g, "");
  const observed = conditionalEnglishCodeLength(text, quadgramModel);
  const trials = options.trials || compressionTrialCount(text.length);
  const random = seededRandom(hashText(text) ^ 0xa341316c);
  const uniformScores = [];
  const shuffleScores = [];
  for (let trial = 0; trial < trials; trial++) {
    uniformScores.push(conditionalEnglishCodeLength(randomText(text.length, random), quadgramModel).bitsPerCharacter);
    shuffleScores.push(conditionalEnglishCodeLength(shuffledText(text, random), quadgramModel).bitsPerCharacter);
  }
  return {
    ...observed,
    length: text.length,
    uniform: summarizeNull(uniformScores, observed.bitsPerCharacter),
    shuffled: summarizeNull(shuffleScores, observed.bitsPerCharacter),
  };
}
