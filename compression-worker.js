import { calibrateEnglishCompression } from "./modules/compression-analysis.js";
import { loadNgramModels } from "./modules/transposition-analysis.js";

self.addEventListener("message", async event => {
  const { token, signature, sequence } = event.data;
  try {
    const models = await loadNgramModels();
    const result = calibrateEnglishCompression(sequence, models[4]);
    self.postMessage({ token, signature, result });
  } catch (error) {
    self.postMessage({ token, signature, error: error?.message || "Compression analysis failed" });
  }
});
