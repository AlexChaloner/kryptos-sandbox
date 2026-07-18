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
  if (kind === "mirror") transformed = matrix.map(row => [...row].reverse());

  const serialized = transformed.flat().map(value => value ?? " ").join("");
  return {
    text: kind === "mirror" ? serialized.replace(/ +$/, "") : serialized,
    columns: kind === "mirror" ? columns : rowCount,
  };
}

export function transformSparseIndex(index, textLength, columns, kind) {
  const rows = Math.ceil(textLength / columns);
  const row = Math.floor(index / columns);
  const column = index % columns;
  if (kind === "right") return column * rows + (rows - 1 - row);
  if (kind === "left") return (columns - 1 - column) * rows + row;
  if (kind === "transpose") return column * rows + row;
  if (kind === "mirror") return row * columns + (columns - 1 - column);
  return index;
}
