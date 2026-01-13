// utils/cgimTypes.ts
export type Year = number;

export interface DictionaryRow {
  ncmRaw: string;
  ncm: string | null; // 8 dígitos
  categoria: string | null;
  subcategoria: string | null;
  source?: {
    fileName?: string;
    sheetName?: string;
    rowNumber?: number; // 1-based
  };
}

export interface NcmYearValue {
  fob: number;
  kg: number;
}

export interface NcmSeries {
  ncmRaw?: string;
  ncm: string | null; // 8 dígitos
  years: Record<string, NcmYearValue>; // "2023" -> {fob,kg}
}

export interface AggregateNodeTotals {
  fob: number;
  kg: number;
}

export interface AggregateNcmNode extends AggregateNodeTotals {
  ncm: string;
  years: Record<string, NcmYearValue>;
  mapping: {
    categoriaKey: string;
    subcategoriaKey: string;
    isMapped: boolean;
  };
}

export interface AggregateSubcategoryNode extends AggregateNodeTotals {
  key: string;
  label: string;
  ncms: Record<string, AggregateNcmNode>;
}

export interface AggregateCategoryNode extends AggregateNodeTotals {
  key: string;
  label: string;
  subcategorias: Record<string, AggregateSubcategoryNode>;
}

export interface CgimDiagnostics {
  dictionary: {
    totalRows: number;
    validNcmRows: number;
    invalidNcmRows: number;
    distinctNcms: number;
    duplicatesSameMapping: number;
    conflictsDifferentMapping: number;
    conflicts: Array<{
      ncm: string;
      mappings: Array<{ categoria: string | null; subcategoria: string | null }>;
    }>;
  };
  aggregation: {
    inputSeries: number;
    invalidNcmSeries: number;
    excludedAllZeroSeries: number;
    includedSeries: number;
    unmappedNcms: Array<{ ncm: string; totalFob: number; totalKg: number }>;
    mappedButMissingCategory: Array<{ ncm: string; subcategoria: string | null }>;
  };
}

export interface CgimAggregate {
  totals: AggregateNodeTotals;
  years: Record<string, NcmYearValue>;
  categorias: Record<string, AggregateCategoryNode>;
  diagnostics: CgimDiagnostics;
}

export interface AggregateOptions {
  targetYears?: Year[];
  includeAllZeroSeries?: boolean; // default false
  keepEmptyBuckets?: boolean;
  labels?: {
    unmappedCategory?: string;
    incompleteMappedCategory?: string;
    noSubcategory?: string;
  };
}
