// Serialize every field and neutralize spreadsheet formulas, even after whitespace/control characters.
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\p{Cc}]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export const csvLine = (values) => values.map(csvCell).join(',');
