const ENGLISH_FREQ = [8.167,1.492,2.782,4.253,12.702,2.228,2.015,6.094,6.966,0.153,0.772,4.025,2.406,6.749,7.507,1.929,0.095,5.987,6.327,9.056,2.758,0.978,2.360,0.150,1.974,0.074];

export function letterCounts(sequence) {
  const counts = Array(26).fill(0);
  for (const letter of sequence) counts[letter.charCodeAt(0) - 65]++;
  return counts;
}

export function indexOfCoincidence(counts, length) {
  if (length < 2) return 0;
  return counts.reduce((sum, count) => sum + count * (count - 1), 0) / (length * (length - 1));
}

export function frequencySimilarity(counts, length) {
  const observed = counts.map(value => value / length);
  const expected = ENGLISH_FREQ.map(value => value / 100);
  const dot = observed.reduce((sum, value, index) => sum + value * expected[index], 0);
  const normA = Math.sqrt(observed.reduce((sum, value) => sum + value * value, 0));
  const normB = Math.sqrt(expected.reduce((sum, value) => sum + value * value, 0));
  return normA ? (dot / (normA * normB)) * 100 : 0;
}

export function periodicColumnAnalysis(sequence, period, alphabetSize = 26) {
  const width = Math.max(1, Math.floor(period));
  const columns = Array.from({ length: width }, (_, offset) => {
    const text = [...sequence].filter((_, index) => index % width === offset).join("");
    return { offset, text, length: text.length, ic: indexOfCoincidence(letterCounts(text), text.length) };
  });
  const averageIc = columns.reduce((sum, column) => sum + column.ic, 0) / columns.length;
  return {
    period: width,
    columns,
    averageIc,
    significance: coincidenceSignificance(averageIc, columns.map(column => column.length), alphabetSize),
  };
}

export function scanVigenerePeriods(sequence, maximumPeriod, alphabetSize = 26) {
  const upper = Math.max(1, Math.min(Math.floor(maximumPeriod), Math.max(1, Math.floor(sequence.length / 2))));
  return Array.from({ length: upper }, (_, index) => periodicColumnAnalysis(sequence, index + 1, alphabetSize));
}

function supportsEnglishShifts(alphabet) {
  return alphabet.length === 26 && [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].every(letter => alphabet.includes(letter));
}

export function suggestVigenereShift(column, alphabet) {
  if (!column.length || !supportsEnglishShifts(alphabet)) return null;
  let best = null;
  for (let shift = 0; shift < alphabet.length; shift++) {
    const decrypted = [...column].map(letter => {
      const cipherIndex = alphabet.indexOf(letter);
      return cipherIndex < 0 ? "" : alphabet[(cipherIndex - shift + alphabet.length) % alphabet.length];
    }).join("");
    const counts = letterCounts(decrypted);
    const score = counts.reduce((sum, count, index) => {
      const expected = decrypted.length * ENGLISH_FREQ[index] / 100;
      return sum + ((count - expected) ** 2 / expected);
    }, 0);
    if (!best || score < best.score) best = { shift, letter: alphabet[shift], score };
  }
  return best;
}

export function suggestVigenereKey(sequence, period, alphabet) {
  const analysis = periodicColumnAnalysis(sequence, period, alphabet.length || 26);
  const shifts = analysis.columns.map(column => suggestVigenereShift(column.text, alphabet));
  return { ...analysis, shifts, key: shifts.map(result => result?.letter || "?").join("") };
}

export function decryptVigenere(sequence, key, alphabet) {
  if (!key.length || !alphabet.length) return "";
  return [...sequence].map((letter, index) => {
    const cipherIndex = alphabet.indexOf(letter);
    const keyIndex = alphabet.indexOf(key[index % key.length]);
    if (cipherIndex < 0 || keyIndex < 0) return "?";
    return alphabet[(cipherIndex - keyIndex + alphabet.length) % alphabet.length];
  }).join("");
}

function normalSurvival(zScore) {
  if (!Number.isFinite(zScore)) return zScore > 0 ? 0 : 1;
  if (zScore < 0) return 1 - normalSurvival(-zScore);
  if (zScore > 6) {
    const inverseSquared = 1 / (zScore * zScore);
    const correction = 1 - inverseSquared + 3 * inverseSquared ** 2 - 15 * inverseSquared ** 3 + 105 * inverseSquared ** 4;
    return Math.exp(-zScore * zScore / 2) / Math.sqrt(2 * Math.PI) / zScore * correction;
  }
  const z = Math.abs(zScore) / Math.sqrt(2);
  const t = 1 / (1 + .3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-z * z);
  const cdf = .5 * (1 + erf);
  return 1 - cdf;
}

function noCollisionProbability(length, alphabetSize) {
  if (length > alphabetSize) return 0;
  let probability = 1;
  for (let index = 0; index < length; index++) probability *= (alphabetSize - index) / alphabetSize;
  return probability;
}

export function coincidenceSignificance(observedIc, sampleSizes, alphabetSize = 26) {
  const lengths = (Array.isArray(sampleSizes) ? sampleSizes : [sampleSizes]).filter(length => length >= 2);
  const nullMean = 1 / alphabetSize;
  const columnVariances = lengths.map(length => 2 * nullMean * (1 - nullMean) / (length * (length - 1)));
  const standardError = lengths.length
    ? Math.sqrt(columnVariances.reduce((sum, variance) => sum + variance, 0)) / lengths.length
    : Infinity;
  const zScore = standardError > 0 && Number.isFinite(standardError) ? (observedIc - nullMean) / standardError : 0;
  const upperPValue = normalSurvival(zScore);
  const lowerPValue = observedIc === 0
    ? lengths.reduce((probability, length) => probability * noCollisionProbability(length, alphabetSize), 1)
    : normalSurvival(-zScore);
  return {
    nullMean,
    standardError,
    zScore,
    pValue: upperPValue,
    upperPValue,
    lowerPValue,
    twoSidedPValue: Math.min(1, 2 * Math.min(lowerPValue, upperPValue)),
    nullLower95: Math.max(0, nullMean - 1.96 * standardError),
    nullUpper95: Math.min(1, nullMean + 1.96 * standardError),
  };
}

export function estimateNulls(length, observedIc, observedFit) {
  const runs = length > 300 ? 250 : 500;
  let icHits = 0, fitHits = 0;
  let seed = (length * 2654435761) >>> 0;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let run = 0; run < runs; run++) {
    const counts = Array(26).fill(0);
    for (let index = 0; index < length; index++) counts[Math.floor(random() * 26)]++;
    if (indexOfCoincidence(counts, length) >= observedIc) icHits++;
    if (frequencySimilarity(counts, length) >= observedFit) fitHits++;
  }
  return { ic: (icHits + 1) / (runs + 1), fit: (fitHits + 1) / (runs + 1) };
}

export function formatPercent(value) {
  const percentage = value * 100;
  if (percentage < 0.1) return "< 0.1%";
  if (percentage < 10) return `${percentage.toFixed(1)}%`;
  return `${Math.round(percentage)}%`;
}

export function formatPValue(value) {
  if (value < 1e-6) return value === 0 ? "< 1e−99" : value.toExponential(1).replace("e-", "e−");
  if (value < .001) return `${(value * 100).toFixed(3)}%`;
  return formatPercent(value);
}
