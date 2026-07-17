export function transformSparseText(text, columns, kind) {
  if (!text.length) return { text: "", columns: Math.max(1, columns) };
  const rowCount = Math.ceil(text.length / columns);
  const matrix = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const index = row * columns + column;
      const value = index < text.length ? text[index] : null;
      return value === " " ? null : value;
    })
  );

  let transformed = matrix;
  if (kind === "right") transformed = matrix[0].map((_, column) => matrix.map(row => row[column]).reverse());
  if (kind === "left") transformed = matrix[0].map((_, column) => matrix.map(row => row[row.length - 1 - column]));
  if (kind === "transpose") transformed = matrix[0].map((_, column) => matrix.map(row => row[column]));

  return {
    text: transformed.flat().map(value => value ?? " ").join(""),
    columns: rowCount,
  };
}
