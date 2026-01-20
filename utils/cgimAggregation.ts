// utils/cgimAggregation.ts
/**
 * CGIM Aggregation
 * - Monta árvore Categoria -> Subcategoria -> NCM
 * - Permite "seed" de categorias/subcategorias a partir do dicionário
 *   (para não sumirem quando o ano selecionado zera tudo)
 */

export type DetailLevel = "CATEGORY" | "SUBCATEGORY" | "NCM";

export type Metrics = { fob: number; kg: number };

export type HierarchyLevel = "category" | "subcategory" | "ncm";

export interface HierarchyNode {
  id: string;
  level: HierarchyLevel;
  name: string;
  metrics: Metrics;
  children?: HierarchyNode[];
  meta?: {
    categoria?: string;
    subcategoria?: string | null;
    ncm?: string;
  };
}

export type DictionaryRow = {
  ncm: string;
  categoria: string;
  subcategoria: string | null;
};

function slug(label: string): string {
  return String(label ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "");
}

export function normalizeNcm(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  const padded = digits.padStart(8, "0");
  if (padded.length !== 8) return null;

  return padded;
}

export function computeTotal(tree: HierarchyNode[]): Metrics {
  let fob = 0;
  let kg = 0;
  for (const n of tree ?? []) {
    fob += n.metrics.fob;
    kg += n.metrics.kg;
  }
  return { fob, kg };
}

export function listCategories(tree: HierarchyNode[]): string[] {
  return (tree ?? []).map((n) => n.name);
}

export function listSubcategories(tree: HierarchyNode[], selectedCategories: string[]): string[] {
  const catSet = new Set((selectedCategories ?? []).filter(Boolean));
  const subs = new Set<string>();

  for (const cat of tree ?? []) {
    if (catSet.size && !catSet.has(cat.name)) continue;
    for (const ch of cat.children ?? []) {
      if (ch.level === "subcategory") subs.add(ch.name);
    }
  }

  return Array.from(subs).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function buildHierarchyTree(args: {
  dictRows: DictionaryRow[]; // usado p/ mapeamento NCM -> categoria/subcategoria
  seedRows?: DictionaryRow[]; // usado só p/ criar a taxonomia (não deixa sumir)
  comexRows: Array<{ ncm: string; metricFOB: number; metricKG: number }>;
  includeUnmapped?: boolean;
  includeAllZero?: boolean; // inclui folhas 0/0
  seedGroupsFromDictionary?: boolean; // mantém categoria/subcat mesmo sem folhas
  includeZeroLeaves?: boolean; // mostra folhas zeradas
}): HierarchyNode[] {
  const includeUnmapped = args.includeUnmapped ?? true;
  const includeAllZero = args.includeAllZero ?? false;
  const seedGroupsFromDictionary = args.seedGroupsFromDictionary ?? false;
  const includeZeroLeaves = args.includeZeroLeaves ?? false;

  // index: NCM -> mapping
  const dictIndex = new Map<string, { categoria: string; subcategoria: string | null }>();
  for (const r of args.dictRows ?? []) {
    const ncm = normalizeNcm(r.ncm);
    if (!ncm) continue;

    const categoria = String(r.categoria ?? "").trim() || "Sem categoria (mapeamento incompleto)";
    const subcategoria = r.subcategoria ? String(r.subcategoria).trim() : null;

    dictIndex.set(ncm, { categoria, subcategoria });
  }

  const catMap = new Map<string, HierarchyNode>();

  // ✅ seed: cria categorias/subcategorias mesmo sem valores
  if (seedGroupsFromDictionary) {
    const rowsForSeed = (args.seedRows ?? args.dictRows) ?? [];
    for (const r of rowsForSeed) {
      const categoria = String(r.categoria ?? "").trim() || "Sem categoria (mapeamento incompleto)";
      const rawSub = r.subcategoria ? String(r.subcategoria).trim() : null;
      const subLabel = rawSub && rawSub.trim() ? rawSub.trim() : "Sem subcategoria";

      if (!catMap.has(categoria)) {
        catMap.set(categoria, {
          id: `cat:${slug(categoria)}`,
          level: "category",
          name: categoria,
          metrics: { fob: 0, kg: 0 },
          children: [],
          meta: { categoria },
        });
      }
      const catNode = catMap.get(categoria)!;

      let subNode = (catNode.children ?? []).find((c) => c.level === "subcategory" && c.name === subLabel);
      if (!subNode) {
        subNode = {
          id: `sub:${slug(categoria)}:${slug(subLabel)}`,
          level: "subcategory",
          name: subLabel,
          metrics: { fob: 0, kg: 0 },
          children: [],
          meta: { categoria, subcategoria: subLabel === "Sem subcategoria" ? null : subLabel },
        };
        catNode.children!.push(subNode);
      }
    }
  }

  // popula comex
  for (const row of args.comexRows ?? []) {
    const ncm = normalizeNcm(row.ncm);
    if (!ncm) continue;

    const fob = Number(row.metricFOB) || 0;
    const kg = Number(row.metricKG) || 0;
    const isZero = fob === 0 && kg === 0;

    if (isZero && !includeAllZero && !includeZeroLeaves) {
      // não cria folha, mas mantém grupo se tiver seed
      continue;
    }

    const mapping = dictIndex.get(ncm);
    if (!mapping && !includeUnmapped) continue;

    const categoria = mapping?.categoria ?? "Sem categoria (não mapeado)";
    const rawSub = mapping?.subcategoria ?? null;
    const subLabel = rawSub && rawSub.trim() ? rawSub.trim() : "Sem subcategoria";

    if (!catMap.has(categoria)) {
      catMap.set(categoria, {
        id: `cat:${slug(categoria)}`,
        level: "category",
        name: categoria,
        metrics: { fob: 0, kg: 0 },
        children: [],
        meta: { categoria },
      });
    }
    const catNode = catMap.get(categoria)!;

    let subNode = (catNode.children ?? []).find((c) => c.level === "subcategory" && c.name === subLabel);
    if (!subNode) {
      subNode = {
        id: `sub:${slug(categoria)}:${slug(subLabel)}`,
        level: "subcategory",
        name: subLabel,
        metrics: { fob: 0, kg: 0 },
        children: [],
        meta: { categoria, subcategoria: subLabel === "Sem subcategoria" ? null : subLabel },
      };
      catNode.children!.push(subNode);
    }

    const ncmNode: HierarchyNode = {
      id: `ncm:${ncm}`,
      level: "ncm",
      name: ncm,
      metrics: { fob, kg },
      meta: { categoria, subcategoria: subLabel === "Sem subcategoria" ? null : subLabel, ncm },
    };

    subNode.children!.push(ncmNode);

    subNode.metrics.fob += fob;
    subNode.metrics.kg += kg;
    catNode.metrics.fob += fob;
    catNode.metrics.kg += kg;
  }

  // se não seed, remove vazios
  if (!seedGroupsFromDictionary) {
    for (const cat of catMap.values()) {
      cat.children = (cat.children ?? []).filter((s) => (s.children ?? []).length > 0);
    }
  }

  const tree = Array.from(catMap.values())
    .filter((c) => seedGroupsFromDictionary || (c.children ?? []).length > 0)
    .sort((a, b) => b.metrics.fob - a.metrics.fob);

  for (const cat of tree) {
    cat.children?.sort((a, b) => b.metrics.fob - a.metrics.fob);
    for (const sub of cat.children ?? []) {
      sub.children?.sort((a, b) => b.metrics.fob - a.metrics.fob);
    }
  }

  return tree;
}
