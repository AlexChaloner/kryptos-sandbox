import { frequencySimilarity, indexOfCoincidence, letterCounts } from "./analysis.js";
import { scoreRouteCandidates } from "./transposition-analysis.js";

const LETTER = /^[A-Z]$/;

function dimensions(text, columns) {
  const cols = Math.max(1, Math.floor(columns) || 1);
  return { cols, rows: Math.ceil(text.length / cols) };
}

function validLetterIndex(text, columns, row, column) {
  const index = row * columns + column;
  return index < text.length && LETTER.test(text[index]) ? index : null;
}

function lineCandidate(text, columns, coordinates, properties) {
  const indices = coordinates
    .map(([row, column]) => validLetterIndex(text, columns, row, column))
    .filter(index => index !== null);
  return { ...properties, indices, route: indices.map(index => text[index]).join("") };
}

export function enumerateGridLines(text, columns, options = {}) {
  const minimumLetters = options.minimumLetters ?? 2;
  const { rows, cols } = dimensions(text, columns);
  const candidates = [];
  const add = (coordinates, properties) => {
    const candidate = lineCandidate(text, cols, coordinates, properties);
    if (candidate.route.length >= minimumLetters) candidates.push(candidate);
  };

  for (let row = 0; row < rows; row++) {
    add(Array.from({ length: cols }, (_, column) => [row, column]), { id: `row-${row}`, kind: "row", label: `R${row + 1}` });
  }
  for (let column = 0; column < cols; column++) {
    add(Array.from({ length: rows }, (_, row) => [row, column]), { id: `column-${column}`, kind: "column", label: `C${column + 1}` });
  }

  let diagonalOrdinal = 0;
  for (let difference = -(cols - 1); difference < rows; difference++) {
    const coordinates = [];
    for (let row = 0; row < rows; row++) {
      const column = row - difference;
      if (column >= 0 && column < cols) coordinates.push([row, column]);
    }
    add(coordinates, { id: `backslash-${difference}`, kind: "diagonal", direction: "backslash", label: `D\\${++diagonalOrdinal}` });
  }
  diagonalOrdinal = 0;
  for (let sum = 0; sum <= rows + cols - 2; sum++) {
    const coordinates = [];
    for (let row = 0; row < rows; row++) {
      const column = sum - row;
      if (column >= 0 && column < cols) coordinates.push([row, column]);
    }
    add(coordinates, { id: `slash-${sum}`, kind: "diagonal", direction: "slash", label: `D/${++diagonalOrdinal}` });
  }
  return candidates;
}

function repeatedBigramDensity(sequence) {
  if (sequence.length < 3) return 0;
  const counts = new Map();
  for (let index = 0; index < sequence.length - 1; index++) {
    const gram = sequence.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  const repeats = [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  return repeats / (sequence.length - 1);
}

export async function scanGridDiagnostics(text, columns, options = {}) {
  const lines = enumerateGridLines(text, columns, options).map(candidate => {
    const counts = letterCounts(candidate.route);
    return {
      ...candidate,
      length: candidate.route.length,
      ic: indexOfCoincidence(counts, candidate.route.length),
      frequencyFit: frequencySimilarity(counts, candidate.route.length),
      repetitionDensity: repeatedBigramDensity(candidate.route),
      alphabetCoverage: new Set(candidate.route).size / 26,
    };
  });
  const result = await scoreRouteCandidates(lines, { ...options, cyclic: false });
  return { ...result, candidates: result.candidates };
}

function coordinateRoute(text, columns, coordinates, properties) {
  return lineCandidate(text, columns, coordinates, properties);
}

function rowCoordinates(rows, cols, reverseRows, reverseWithin, serpentine = false) {
  const coordinates = [];
  const rowOrder = Array.from({ length: rows }, (_, row) => reverseRows ? rows - row - 1 : row);
  rowOrder.forEach((row, ordinal) => {
    const reverse = serpentine ? Boolean(reverseWithin) !== Boolean(ordinal % 2) : reverseWithin;
    for (let offset = 0; offset < cols; offset++) coordinates.push([row, reverse ? cols - offset - 1 : offset]);
  });
  return coordinates;
}

function columnCoordinates(rows, cols, reverseColumns, reverseWithin, serpentine = false) {
  const coordinates = [];
  const columnOrder = Array.from({ length: cols }, (_, column) => reverseColumns ? cols - column - 1 : column);
  columnOrder.forEach((column, ordinal) => {
    const reverse = serpentine ? Boolean(reverseWithin) !== Boolean(ordinal % 2) : reverseWithin;
    for (let offset = 0; offset < rows; offset++) coordinates.push([reverse ? rows - offset - 1 : offset, column]);
  });
  return coordinates;
}

function diagonalGroups(rows, cols, direction) {
  const groups = [];
  if (direction === "backslash") {
    for (let difference = -(cols - 1); difference < rows; difference++) {
      const group = [];
      for (let row = 0; row < rows; row++) {
        const column = row - difference;
        if (column >= 0 && column < cols) group.push([row, column]);
      }
      groups.push(group);
    }
  } else {
    for (let sum = 0; sum <= rows + cols - 2; sum++) {
      const group = [];
      for (let row = 0; row < rows; row++) {
        const column = sum - row;
        if (column >= 0 && column < cols) group.push([row, column]);
      }
      groups.push(group);
    }
  }
  return groups;
}

function spiralCoordinates(rows, cols, corner, clockwise) {
  const starts = { NW: [0, 0], NE: [0, cols - 1], SE: [rows - 1, cols - 1], SW: [rows - 1, 0] };
  const clockwiseDirections = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const counterDirections = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const clockwiseStarts = { NW: 0, NE: 1, SE: 2, SW: 3 };
  const counterStarts = { NW: 0, SW: 1, SE: 2, NE: 3 };
  const directions = clockwise ? clockwiseDirections : counterDirections;
  let direction = (clockwise ? clockwiseStarts : counterStarts)[corner];
  let [row, column] = starts[corner];
  const visited = new Set();
  const coordinates = [];
  for (let count = 0; count < rows * cols; count++) {
    coordinates.push([row, column]);
    visited.add(`${row},${column}`);
    let nextRow = row + directions[direction][0];
    let nextColumn = column + directions[direction][1];
    if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= cols || visited.has(`${nextRow},${nextColumn}`)) {
      direction = (direction + 1) % directions.length;
      nextRow = row + directions[direction][0];
      nextColumn = column + directions[direction][1];
    }
    row = nextRow;
    column = nextColumn;
  }
  return coordinates;
}

export function generateGridRoutes(text, columns) {
  const { rows, cols } = dimensions(text, columns);
  const candidates = [];
  const seen = new Set();
  const add = (coordinates, properties) => {
    const candidate = coordinateRoute(text, cols, coordinates, properties);
    if (candidate.route.length < 2) return;
    const signature = candidate.indices.join(",");
    if (seen.has(signature)) return;
    seen.add(signature);
    candidates.push({ ...candidate, outputColumns: cols });
  };

  for (const reverseRows of [false, true]) for (const reverseWithin of [false, true]) {
    const vertical = reverseRows ? "bottom" : "top";
    const horizontal = reverseWithin ? "right" : "left";
    add(rowCoordinates(rows, cols, reverseRows, reverseWithin), { id: `rows-${vertical}-${horizontal}`, family: "rows", label: `Rows · ${vertical} → ${horizontal}` });
    add(rowCoordinates(rows, cols, reverseRows, reverseWithin, true), { id: `row-snake-${vertical}-${horizontal}`, family: "boustrophedon", label: `Row snake · ${vertical} / ${horizontal}` });
  }
  for (const reverseColumns of [false, true]) for (const reverseWithin of [false, true]) {
    const horizontal = reverseColumns ? "right" : "left";
    const vertical = reverseWithin ? "bottom" : "top";
    add(columnCoordinates(rows, cols, reverseColumns, reverseWithin), { id: `columns-${horizontal}-${vertical}`, family: "columns", label: `Columns · ${horizontal} → ${vertical}` });
    add(columnCoordinates(rows, cols, reverseColumns, reverseWithin, true), { id: `column-snake-${horizontal}-${vertical}`, family: "boustrophedon", label: `Column snake · ${horizontal} / ${vertical}` });
  }
  for (const direction of ["backslash", "slash"]) {
    const groups = diagonalGroups(rows, cols, direction);
    for (const reverseGroups of [false, true]) for (const reverseWithin of [false, true]) {
      const orderedGroups = reverseGroups ? [...groups].reverse() : groups;
      const coordinates = orderedGroups.flatMap(group => reverseWithin ? [...group].reverse() : group);
      const glyph = direction === "backslash" ? "\\" : "/";
      add(coordinates, {
        id: `diagonal-${direction}-${Number(reverseGroups)}-${Number(reverseWithin)}`,
        family: "diagonals",
        label: `Diagonal ${glyph} · sweep ${reverseGroups ? "reverse" : "forward"}${reverseWithin ? " · flip" : ""}`,
      });
    }
  }
  for (const corner of ["NW", "NE", "SE", "SW"]) for (const clockwise of [true, false]) {
    add(spiralCoordinates(rows, cols, corner, clockwise), {
      id: `spiral-${corner}-${clockwise ? "cw" : "ccw"}`,
      family: "spiral",
      label: `Spiral · ${corner} · ${clockwise ? "clockwise" : "counterclockwise"}`,
    });
  }
  return candidates;
}

export async function scanGridRoutes(text, columns, options = {}) {
  const result = await scoreRouteCandidates(generateGridRoutes(text, columns), { ...options, cyclic: false });
  result.candidates.sort((a, b) => b.score - a.score);
  return result;
}
