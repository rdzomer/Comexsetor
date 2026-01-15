// services/cgimDictionaryService.ts
import * as XLSX from "xlsx";

export interface CgimDictEntry {
  ncm: string;
  categoria: string | null; // SOMENTE COLUNA "Categoria" (M)
  subcategorias: Array<string | null>; // N/O/P/Q (quando existir)
  source?: {
    fileName?: string;
    sheetName?: string;
    rowNumber?: number;
    headerRow?: number;
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
  publicPath?: string;
  cacheKey?: string;
  sheetWhitelist?: string[];
}

const DEFAULT_PUBLIC_PATH = "/dictionaries/cgim_dinte.xlsx";
const DEFAULT_CACHE_KEY = "cgim:dict:excel:v4"; // bump pra limpar cache antigo

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

// ✅ trata 0 como vazio (0 ou "0" ou "0,0" etc.)
function safeStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (v === 0) return "";
    return String(v).trim();
  }
  const s = String(v).trim();
  if (!s) return "";
  // se vier "0" (muito comum nessas colunas), ignora
  if (s === "0") return "";
  return s;
}

/**
 * Detecta a linha de cabeçalho procurando uma linha que contenha:
 * - NCM
 * - Categoria
 * (isso evita pegar linhas intermediárias ou cabeçalhos incompletos)
 */
function detectHeaderRow(rows: any[][]): number {
  const maxScan = Math.min(rows.length, 80);
  for (let i = 0; i < maxScan; i++) {
    const line = rows[i] ?? [];
    const headers = line.map(normHeader);

    const hasNcm = headers.some((h) => h === "ncm" || h.includes("ncm"));
    const hasCategoria = headers.some((h) => h === "categoria");

    if (hasNcm && hasCategoria) return i;
  }

  // fallback antigo: se não achar ambos, procura só NCM
  for (let i = 0; i < maxScan; i++) {
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

  // ✅ Categoria = SOMENTE "categoria" (coluna M)
  const categoriaCol = findIdx((h) => h === "categoria") ?? null;

  // Subcategorias (1..n): "subcategoria (1)", "subcategoria (2)" etc.
  const subcategoriaCols: number[] = [];
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i];
    if (!h) continue;
    if (h === "subcategoria" || h.startsWith("subcategoria")) {
      subcategoriaCols.push(i);
    }
  }

  return { ncmCol, categoriaCol, subcategoriaCols, headerRowIdx };
}

function firstNonEmpty(arr?: Array<string | null | undefined>): string | null {
  if (!arr?.length) return null;
  for (const x of arr) {
    const s = String(x ?? "").trim();
    if (s) return s;
  }
  return null;
}

export async function loadCgimDictionaryFromExcel(
  options: LoadCgimDictionaryOptions = {}
): Promise<CgimDictionaryPack> {
  const publicPath = options.publicPath ?? DEFAULT_PUBLIC_PATH;
  const cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY;

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

  const masterNames = new Set(["NCMs-CGIM-DINTE", "NCMs-CGIM", "DICIONARIO", "DICIONÁRIO", "MASTER"]);
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

      const subcategorias: Array<string | null> = (cols.subcategoriaCols ?? []).map((cIdx) => {
        const v = safeStr(line[cIdx]); // ✅ já remove 0
        return v ? v : null;
      });

      const subFirst = firstNonEmpty(subcategorias) ?? "";

      // descarta linha totalmente vazia
      if (!safeStr(ncmRaw) && !categoriaRaw && !subFirst) continue;

      if (!ncm) {
        invalidNcmRows++;
        continue;
      }

      out.push({
        ncm,
        categoria: categoriaRaw ? categoriaRaw : null,
        subcategorias,
        source: { fileName: publicPath, sheetName, rowNumber: r + 1, headerRow: headerRowIdx + 1 },
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

async function loadPackCached(): Promise<CgimDictionaryPack> {
  return await loadCgimDictionaryFromExcel();
}

export async function loadCgimDictionaryForEntity(entity: string): Promise<CgimDictEntry[]> {
  const pack = await loadPackCached();
  return pack.entriesByEntity?.[entity] ?? [];
}

// aliases (compat)
export async function loadDictionaryForEntity(entity: string) { return loadCgimDictionaryForEntity(entity); }
export async function getCgimDictionaryForEntity(entity: string) { return loadCgimDictionaryForEntity(entity); }
export async function getDictionaryForEntity(entity: string) { return loadCgimDictionaryForEntity(entity); }

export function getFirstSubcategory(entry: CgimDictEntry): string | null {
  return firstNonEmpty(entry.subcategorias);
}
