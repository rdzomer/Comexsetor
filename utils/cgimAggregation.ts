// utils/cgimAggregation.ts
/**
 * CGIM Aggregation (consolidado em 1 arquivo)
 * - Compatível com CgimAnalyticsPage.tsx "bonito"
 * - Não depende de cgimAggregationCanonical.ts
 *
 * Responsabilidades:
 * 1) Normalizar NCM (8 dígitos)
 * 2) Construir árvore Categoria -> Subcategoria -> NCM
 * 3) Helpers para UI: total, listas de categorias/subcategorias
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

/**
 * Normaliza NCM para 8 dígitos.
 * Retorna null se não der pra formar uma NCM válida.
 */
export function normalizeNcm(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // Excel às vezes tira zeros à esquerda
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

/**
 * Constrói a árvore usando explicitamente o dicionário.
 *
 * includeUnmapped:
 *  - true: NCMs que vierem do Comex mas não estiverem no dicionário vão para "Sem categoria (não mapeado)"
 *  - false: descarta NCMs sem mapeamento
 *
 * includeAllZero:
 *  - false (padrão): remove NCMs com (FOB=0 e KG=0)
 *  - true: mantém (útil só pra auditoria)
 */
export function buildHierarchyTree(args: {
  dictRows: DictionaryRow[];
  /**
   * Opcional: linhas usadas APENAS para semear (criar) a estrutura de
   * categorias/subcategorias (taxonomia).
   *
   * Motivação (CGIM): quando existem NCMs duplicadas no Excel (mesma NCM em
   * mais de uma categoria/subcategoria), a UI pode deduplicar as linhas para
   * evitar conflitos de mapeamento. Se usarmos apenas as linhas deduplicadas
   * para “seedar” a árvore, algumas categorias/subcategorias podem sumir.
   *
   * Este campo permite manter a taxonomia completa (seedRows), enquanto o
   * mapeamento NCM->categoria/subcategoria continua consistente (dictRows).
   */
  seedRows?: DictionaryRow[];
  comexRows: Array<{ ncm: string; metricFOB: number; metricKG: number }>;
  includeUnmapped?: boolean;
  includeAllZero?: boolean;
  /**
   * ✅ CGIM: quando true, cria categorias/subcategorias a partir do dicionário
   * mesmo que não exista nenhum NCM com valor no Comex para o recorte.
   * Isso evita “sumir” categorias (ex: Semi-acabados) quando tudo estiver 0.
   */
  seedGroupsFromDictionary?: boolean;
  /**
   * ✅ CGIM: quando false (padrão), NCMs com (FOB=0 e KG=0) não aparecem como folhas,
   * mas o grupo (categoria/subcategoria) pode permanecer (seedGroupsFromDictionary).
   */
  includeZeroLeaves?: boolean;
}): HierarchyNode[] {
  const includeUnmapped = args.includeUnmapped ?? true;
  const includeAllZero = args.includeAllZero ?? false;
  const seedGroupsFromDictionary = args.seedGroupsFromDictionary ?? false;
  const includeZeroLeaves = args.includeZeroLeaves ?? false;

  // index do dicionário: ncm -> {categoria, subcategoria}
  const dictIndex = new Map<string, { categoria: string; subcategoria: string | null }>();

  for (const r of args.dictRows ?? []) {
    const ncm = normalizeNcm(r.ncm);
    if (!ncm) continue;

    const categoria = String(r.categoria ?? "").trim() || "Sem categoria (mapeamento incompleto)";
    const subcategoria = r.subcategoria ? String(r.subcategoria).trim() : null;

    dictIndex.set(ncm, { categoria, subcategoria });
  }

  // acumula nós por categoria
  const catMap = new Map<string, HierarchyNode>();

  // ✅ (opcional) semeia categorias/subcategorias a partir do dicionário
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

  for (const row of args.comexRows ?? []) {
    const ncm = normalizeNcm(row.ncm);
    if (!ncm) continue;

    const fob = Number(row.metricFOB) || 0;
    const kg = Number(row.metricKG) || 0;

    const isZero = fob === 0 && kg === 0;

    // includeAllZero: mant. (útil p/ auditoria)
    // includeZeroLeaves: mostra folhas zeradas
    // seedGroupsFromDictionary: mantém grupos mesmo sem folhas
    if (isZero && !includeAllZero && !includeZeroLeaves) {
      // não adiciona a folha, mas mantém o grupo se tiver sido semeado
      continue;
    }

    const mapping = dictIndex.get(ncm);

    if (!mapping && !includeUnmapped) continue;

    const categoria = mapping?.categoria ?? "Sem categoria (não mapeado)";
    const rawSub = mapping?.subcategoria ?? null;
    const subLabel = rawSub && rawSub.trim() ? rawSub.trim() : "Sem subcategoria";

    // Categoria node
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

    // Subcategoria node
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

    // NCM leaf
    const ncmNode: HierarchyNode = {
      id: `ncm:${ncm}`,
      level: "ncm",
      name: ncm,
      metrics: { fob, kg },
      meta: { categoria, subcategoria: subLabel === "Sem subcategoria" ? null : subLabel, ncm },
    };

    subNode.children!.push(ncmNode);

    // Soma métricas
    subNode.metrics.fob += fob;
    subNode.metrics.kg += kg;
    catNode.metrics.fob += fob;
    catNode.metrics.kg += kg;
  }

  // ✅ remove subcategorias vazias se não semeamos (comportamento antigo)
  if (!seedGroupsFromDictionary) {
    for (const cat of catMap.values()) {
      cat.children = (cat.children ?? []).filter((s) => (s.children ?? []).length > 0);
    }
  }

  // ✅ remove categorias vazias se não semeamos
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
