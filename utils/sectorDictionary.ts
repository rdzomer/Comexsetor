export type SectorDictRow = {
  ncm: string; // 8 dígitos
  setor: string;
  categoria: string;
  subcategoria: string;
  descricao_institucional?: string;
  codigo_interno?: string;
};

function normalizeNcm(ncm: string): string {
  return (ncm || "").toString().replace(/\D/g, "").padStart(8, "0").slice(0, 8);
}

// CSV simples (sem campos com vírgula dentro)
function parseCsvLine(line: string): string[] {
  return line.split(",").map((s) => s.trim());
}

export async function loadSectorDictionaryCsv(url: string): Promise<SectorDictRow[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao carregar dicionário: ${url} (HTTP ${res.status})`);
  const text = await res.text();

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const rows: SectorDictRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const obj: any = {};
    header.forEach((h, idx) => (obj[h] = cols[idx] ?? ""));

    rows.push({
      ncm: normalizeNcm(obj.ncm),
      setor: obj.setor,
      categoria: obj.categoria,
      subcategoria: obj.subcategoria,
      descricao_institucional: obj.descricao_institucional || undefined,
      codigo_interno: obj.codigo_interno || undefined,
    });
  }

  return rows;
}

export function buildNcmMap(dict: SectorDictRow[]): Map<string, SectorDictRow> {
  const map = new Map<string, SectorDictRow>();
  for (const row of dict) map.set(normalizeNcm(row.ncm), row);
  return map;
}
