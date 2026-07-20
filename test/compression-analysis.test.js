import assert from "node:assert/strict";
import test from "node:test";
import { calibrateEnglishCompression, conditionalEnglishCodeLength, compressionTrialCount } from "../modules/compression-analysis.js";

const tinyEnglishModel = {
  floor: -8,
  table: {
    THET: -1,
    HETH: -1,
    ETHE: -1,
    THEM: -1.2,
  },
};

test("conditional English coding rewards model-supported continuations", () => {
  const englishLike = conditionalEnglishCodeLength("THETHETHE", tinyEnglishModel);
  const unsupported = conditionalEnglishCodeLength("THXTHXTHX", tinyEnglishModel);
  assert.ok(englishLike.bitsPerCharacter < unsupported.bitsPerCharacter);
  assert.equal(englishLike.bits, englishLike.bitsPerCharacter * 9);
});

test("compression calibration is deterministic and preserves an exact-length null", () => {
  const first = calibrateEnglishCompression("THETHETHEMTHETHE", tinyEnglishModel, { trials: 39 });
  const second = calibrateEnglishCompression("THETHETHEMTHETHE", tinyEnglishModel, { trials: 39 });
  assert.deepEqual(first, second);
  assert.equal(first.uniform.trials, 39);
  assert.equal(first.shuffled.trials, 39);
  assert.ok(first.uniform.pValue > 0 && first.uniform.pValue <= 1);
});

test("production calibration has enough resolution for a 0.5% signal", () => {
  assert.ok(compressionTrialCount(97) >= 999);
  assert.ok(1 / (compressionTrialCount(97) + 1) < .005);
});
