// services/cgimDictionaryService.ts
import * as XLSX from "xlsx";

/**
 * Este service fornece DUAS APIs:
 *
 * A) API "nova" (por entidade) - mantendo compatibilidade com o que já existe no seu app:
 *    - loadCgimDictionaryForEntity(entity)
 *    - loadDictionaryForEntity(entity)
 *    - getCgimDictionaryForEntity(entity)
 *    - getDictionaryForEntity(entity)
 *
 * B) API "antiga/compat" usada pelo seu CgimAnalyticsPage.tsx bonito:
 *    - loadCgimDictionaryFromExcel() -> { entities, entriesByEntity }
 */

export interface CgimDictEntry {
  ncm: string; // 8 dígitos
  categoria: string | null;
  subcategorias: Array<string | null>;
  source?: {
    fileName?: string;
    sheetName?: string;
    rowNumber?: number; // 1-based
    headerRow?: number; // 1-based
  };
}

export interface CgimDictionaryPack {
  entities: string[];
  entriesByEntity: Record<string, CgimDictEntry[]>;
  diagnostics: {
    fileName: string;
    sheetsRead: string[];
    totalEntries: number;
    distinctNcms: number;
    invalidNcmRows: number;
  };
}

export interface LoadCgimDictionaryOptions {
  publicPath?: string; // default: "/dictionaries/cgim_dinte.xlsx"
  cacheKey?: string;   // default: "cgim:dict:excel:v1"
  sheetWhitelist?: string[]; // opcional
}

const DEFAULT_PUBLIC_PATH = "/dictionaries/cgim_dinte.xlsx";
const DEFAULT_CACHE_KEY = "cgim:dict:excel:v1";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function normHeader(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeNcmTo8(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const padded = digits.padStart(8, "0");
  return padded.length === 8 ? padded : null;
}

function safeStr(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

function detectHeaderRow(rows: any[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const line = rows[i] ?? [];
    const hasNcm = line.some((cell) => {
      const h = normHeader(cell);
      return h === "ncm" || h.includes("ncm");
    });
    if (hasNcm) return i;
  }
  return 0;
}

function guessColumns(rows: any[][], headerRowIdx: number) {
  const header = rows[headerRowIdx] ?? [];
  const norm = header.map(normHeader);

  const findIdx = (pred: (h: string) => boolean): number | null => {
    const i = norm.findIndex(pred);
    return i >= 0 ? i : null;
  };

  const ncmCol =
    findIdx((h) => h === "ncm" || h.includes("codigo ncm") || h.includes("cod ncm")) ??
    findIdx((h) => h.includes("ncm")) ??
    null;

  if (ncmCol === null) throw new Error("cgimDictionaryService: não consegui achar coluna NCM.");

  // Categoria: prioriza "categoria", depois "setor", depois "segmento"
  const categoriaCol =
    findIdx((h) => h === "categoria") ??
    findIdx((h) => h === "setor") ??
    findIdx((h) => h === "segmento") ??
    null;

  // Subcategoria: prioriza "subcategoria" / "subsegmento", fallback "segmento"
  const subcategoriaCol =
    findIdx((h) => h === "subcategoria" || h.includes("sub categoria") || h.includes("sub-categoria")) ??
    findIdx((h) => h === "subsegmento") ??
    findIdx((h) => h === "segmento") ??
    null;

  return { ncmCol, categoriaCol, subcategoriaCol, headerRowIdx };
}

function firstNonEmpty(arr?: Array<string | null | undefined>): string | null {
  if (!arr?.length) return null;
  for (const x of arr) {
    const s = String(x ?? "").trim();
    if (s) return s;
  }
  return null;
}

// ------------------------------------------------------------
// API B (compat) - usada pelo CgimAnalyticsPage.tsx "bonito"
// ------------------------------------------------------------

export async function loadCgimDictionaryFromExcel(
  options: LoadCgimDictionaryOptions = {}
): Promise<CgimDictionaryPack> {
  const publicPath = options.publicPath ?? DEFAULT_PUBLIC_PATH;
  const cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY;

  // cache
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as CgimDictionaryPack;
      if (parsed?.entities?.length) return parsed;
    } catch {
      // ignore
    }
  }

  const res = await fetch(publicPath);
  if (!res.ok) throw new Error(`Falha ao carregar dicionário em ${publicPath} (HTTP ${res.status}).`);
  const buf = await res.arrayBuffer();

  const wb = XLSX.read(buf, { type: "array" });

  const allSheets = wb.SheetNames ?? [];

  // costuma existir uma aba "master" tipo "NCMs-CGIM-DINTE" — excluímos
  const masterNames = new Set([
    "NCMs-CGIM-DINTE",
    "NCMs-CGIM",
    "DICIONARIO",
    "DICIONÁRIO",
    "MASTER",
  ]);

  const entitySheets = allSheets.filter((s) => !masterNames.has(s));

  const sheetsToRead = options.sheetWhitelist?.length
    ? entitySheets.filter((s) => options.sheetWhitelist!.includes(s))
    : entitySheets;

  const entriesByEntity: Record<string, CgimDictEntry[]> = {};
  let invalidNcmRows = 0;

  for (const sheetName of sheetsToRead) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!rows?.length) continue;

    const headerRowIdx = detectHeaderRow(rows);
    const cols = guessColumns(rows, headerRowIdx);

    const out: CgimDictEntry[] = [];

    for (let r = cols.headerRowIdx + 1; r < rows.length; r++) {
      const line = rows[r] ?? [];

      const ncmRaw = line[cols.ncmCol];
      const ncm = normalizeNcmTo8(ncmRaw);

      const categoriaRaw = cols.categoriaCol !== null ? safeStr(line[cols.categoriaCol]) : "";
      const subRaw = cols.subcategoriaCol !== null ? safeStr(line[cols.subcategoriaCol]) : "";

      // descarta linha totalmente vazia
      if (!safeStr(ncmRaw) && !categoriaRaw && !subRaw) continue;

      if (!ncm) {
        invalidNcmRows++;
        continue;
      }

      const categoria = categoriaRaw ? categoriaRaw : null;
      const subcategorias: Array<string | null> = [subRaw ? subRaw : null];

      out.push({
        ncm,
        categoria,
        subcategorias,
        source: {
          fileName: publicPath,
          sheetName,
          rowNumber: r + 1,
          headerRow: headerRowIdx + 1,
        },
      });
    }

    entriesByEntity[sheetName] = out;
  }

  const entities = Object.keys(entriesByEntity).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const allEntries = entities.flatMap((e) => entriesByEntity[e] ?? []);
  const distinctNcms = new Set(allEntries.map((x) => x.ncm)).size;

  const pack: CgimDictionaryPack = {
    entities,
    entriesByEntity,
    diagnostics: {
      fileName: publicPath,
      sheetsRead: entities,
      totalEntries: allEntries.length,
      distinctNcms,
      invalidNcmRows,
    },
  };

  try {
    localStorage.setItem(cacheKey, JSON.stringify(pack));
  } catch {
    // ignore
  }

  return pack;
}

// ------------------------------------------------------------
// API A (por entidade) - mantendo compatibilidade com o que já existe
// ------------------------------------------------------------

async function loadPackCached(): Promise<CgimDictionaryPack> {
  // sempre usa a API B como fonte única
  return await loadCgimDictionaryFromExcel();
}

export async function loadCgimDictionaryForEntity(entity: string): Promise<CgimDictEntry[]> {
  const pack = await loadPackCached();
  return pack.entriesByEntity?.[entity] ?? [];
}

// aliases antigos existentes no seu app (mantidos)
export async function loadDictionaryForEntity(entity: string): Promise<CgimDictEntry[]> {
  return await loadCgimDictionaryForEntity(entity);
}

export async function getCgimDictionaryForEntity(entity: string): Promise<CgimDictEntry[]> {
  return await loadCgimDictionaryForEntity(entity);
}

export async function getDictionaryForEntity(entity: string): Promise<CgimDictEntry[]> {
  return await loadCgimDictionaryForEntity(entity);
}

// util opcional (caso algum lugar precise)
export function getFirstSubcategory(entry: CgimDictEntry): string | null {
  return firstNonEmpty(entry.subcategorias);
}
