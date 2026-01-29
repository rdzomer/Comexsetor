// components/CgimAnalyticsPage.tsx
import React, { useState, useEffect, useMemo } from "react";
import Section from "./Section";
import CgimStickyLoader from "./cgim/CgimStickyLoader";
import CgimControlsPanel from "./cgim/CgimControlsPanel";
// import CgimAnnualChartsPanel from "./cgim/CgimAnnualChartsPanel"; // Removido/Integrado
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

import CgimHierarchyTable from "./cgim/CgimHierarchyTable"; // Certifique-se que o caminho está certo

import {
  buildHierarchyTree,
  computeTotal,
  listCategories,
  listSubcategories,
  type DetailLevel,
  type HierarchyNode,
  type DictionaryRow,
} from "../utils/cgimAggregation";

import * as cgimDictionaryService from "../services/cgimDictionaryService";
import { fetchComexYearByNcmList } from "../services/comexApiService";
import { fetchBasketAnnualSeries, type BasketAnnualPoint } from "../services/cgimBasketTimeseriesService";

type SortKey = "fob" | "kg";
type SortDir = "asc" | "desc";
type FlowType = "import" | "export";
type ViewMode = "TABLE" | "CHARTS" | "BOTH";

// Formatações simples para os gráficos
const formatMoneyUS = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const formatKg = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export default function CgimAnalyticsPage() {
  // --- STATES ---
  const [entity, setEntity] = useState<string>("");
  const [year, setYear] = useState<number>(new Date().getFullYear() - 1);
  const [flow, setFlow] = useState<FlowType>("import");

  const [loadingDict, setLoadingDict] = useState(false);
  const [dictionary, setDictionary] = useState<DictionaryRow[]>([]);

  // Tabela
  const [loadingTable, setLoadingTable] = useState(false);
  const [tableTree, setTableTree] = useState<HierarchyNode[]>([]);
  const [tableBuilt, setTableBuilt] = useState(false);

  // Gráficos (Série)
  const [seriesData, setSeriesData] = useState<BasketAnnualPoint[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [chartsVisible, setChartsVisible] = useState(false); // Controla se mostra os gráficos

  // Controles UI
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("category");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("fob");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // 1. Carrega Dicionário ao mudar entidade
  useEffect(() => {
    if (!entity) return;
    setLoadingDict(true);
    cgimDictionaryService
      .loadCgimDictionaryForEntity(entity)
      .then((rows: any[]) => {
        setDictionary(rows);
        // Reseta tudo ao mudar entidade
        setTableBuilt(false);
        setTableTree([]);
        setSeriesData([]);
        setChartsVisible(false);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoadingDict(false));
  }, [entity]);

  // Lista de NCMs atuais (filtrada por categoria se necessário)
  const basketNcms = useMemo(() => {
    let filtered = dictionary;
    // Se quiser aplicar filtros de categoria aos gráficos também, descomente abaixo:
    // if (selectedCategories.length > 0) {
    //   filtered = filtered.filter(d => d.categoria && selectedCategories.includes(d.categoria));
    // }
    return filtered.map((d) => d.ncm).filter((n) => n && n.length === 8);
  }, [dictionary, selectedCategories]);

  // Opções para filtros UI
  const allCategories = useMemo(() => listCategories(dictionary), [dictionary]);
  const allSubcategories = useMemo(() => listSubcategories(dictionary), [dictionary]);

  // --- AÇÃO 1: INICIAR ANÁLISE (Só carrega a Tabela) ---
  const handleRunAnalysis = async () => {
    if (!basketNcms.length) {
      alert("Nenhum NCM encontrado para esta entidade.");
      return;
    }

    setLoadingTable(true);
    setChartsVisible(false); // Esconde gráficos antigos para não confundir
    setSeriesData([]); 

    try {
      console.log(`Buscando dados de ${year} para ${basketNcms.length} NCMs...`);
      
      // Busca dados do ano selecionado (detalhado por NCM para a tabela)
      const rows = await fetchComexYearByNcmList({
        flow,
        year,
        ncms: basketNcms,
        lite: false,
      });

      // Monta a árvore da tabela
      const tree = buildHierarchyTree(dictionary, rows, {
        detailLevel,
        filterCategories: selectedCategories.length ? selectedCategories : undefined,
        filterSubcategories: selectedSubcategories.length ? selectedSubcategories : undefined,
      });

      setTableTree(tree);
      setTableBuilt(true);
    } catch (error) {
      console.error(error);
      alert("Erro ao buscar dados da tabela. Tente novamente.");
    } finally {
      setLoadingTable(false);
    }
  };

  // --- AÇÃO 2: CARREGAR SÉRIE HISTÓRICA (Gráficos) ---
  const handleLoadCharts = async () => {
    if (!basketNcms.length) return;

    setLoadingSeries(true);
    setChartsVisible(true);

    try {
      const endYear = new Date().getFullYear();
      const startYear = endYear - 10; // Últimos 10 anos + atual

      const data = await fetchBasketAnnualSeries({
        entityName: entity,
        flowUi: flow,
        yearStart: startYear,
        yearEnd: endYear,
        ncms: basketNcms,
      });
      setSeriesData(data);
    } catch (error) {
      console.error(error);
      alert("Erro ao carregar gráficos.");
    } finally {
      setLoadingSeries(false);
    }
  };

  // Calcula totais para mostrar no cabeçalho
  const totals = useMemo(() => computeTotal(tableTree), [tableTree]);

  return (
    <>
      <Section title="Análise Setorial (CGIM 2.0)">
        <CgimControlsPanel
          entity={entity}
          onEntityChange={setEntity}
          year={year}
          onYearChange={setYear}
          flow={flow}
          onFlowChange={setFlow}
          disabled={loadingDict || loadingTable}
          onRun={handleRunAnalysis}
          
          // Props extras de filtro
          availableCategories={allCategories}
          selectedCategories={selectedCategories}
          onCategoriesChange={setSelectedCategories}
          availableSubcategories={allSubcategories}
          selectedSubcategories={selectedSubcategories}
          onSubcategoriesChange={setSelectedSubcategories}
          detailLevel={detailLevel}
          onDetailLevelChange={setDetailLevel}
        />
      </Section>

      {/* LOADING TABELA */}
      {loadingTable && <CgimStickyLoader message={`Buscando dados de ${year}...`} />}

      {/* CONTEÚDO PRINCIPAL */}
      {tableBuilt && !loadingTable && (
        <div style={{ padding: "0 20px 40px 20px" }}>
          
          {/* 1. CARTÃO DA TABELA */}
          <div style={{ background: "white", padding: 20, borderRadius: 8, boxShadow: "0 2px 5px rgba(0,0,0,0.1)", marginBottom: 30 }}>
            <h3 style={{ marginTop: 0, color: "#333" }}>Detalhamento {year} ({flow === "import" ? "Importação" : "Exportação"})</h3>
            <div style={{ display: "flex", gap: 20, marginBottom: 15, fontSize: "0.9rem", color: "#666" }}>
              <strong>Total FOB: {formatMoneyUS(totals.fob)}</strong>
              <strong>Total KG: {formatKg(totals.kg)}</strong>
            </div>

            <CgimHierarchyTable
              tree={tableTree}
              detailLevel={detailLevel}
              selectedCategories={selectedCategories}
              selectedSubcategories={selectedSubcategories}
              expandedIds={expandedIds}
              onToggleExpand={(id) => {
                setExpandedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              sortKey={sortKey}
              sortDir={sortDir}
              onChangeSort={(k) => {
                setSortKey((prevKey) => {
                  if (prevKey !== k) {
                    setSortDir("desc");
                    return k;
                  }
                  setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                  return prevKey;
                });
              }}
              formatFOB={formatMoneyUS}
              formatKG={formatKg}
            />
          </div>

          {/* 2. ÁREA DOS GRÁFICOS */}
          <div style={{ background: "#f8f9fa", padding: 25, borderRadius: 8, border: "1px solid #e9ecef" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, color: "#444" }}>Série Histórica (Evolução)</h3>
              
              {/* O BOTÃO QUE SALVA O NETLIFY */}
              {!chartsVisible && (
                <button 
                  onClick={handleLoadCharts}
                  style={{
                    padding: "10px 20px",
                    background: "#0d6efd",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 600,
                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                  }}
                >
                  📊 Carregar Gráficos Anuais
                </button>
              )}
            </div>

            {loadingSeries && (
              <div style={{ padding: 40, textAlign: "center", color: "#666" }}>
                <p>Consultando base histórica do MDIC...</p>
              </div>
            )}

            {chartsVisible && !loadingSeries && seriesData.length === 0 && (
              <p style={{ color: "#888" }}>Nenhum dado encontrado para o período.</p>
            )}

            {/* GRÁFICO (RENDERIZADO DIRETO AQUI PARA SIMPLIFICAR) */}
            {chartsVisible && !loadingSeries && seriesData.length > 0 && (
              <div style={{ height: 400, width: "100%", background: "white", padding: 10, borderRadius: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={seriesData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="year" />
                    <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                    <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                    <Tooltip formatter={(val: number) => val.toLocaleString("pt-BR")} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="fob" name="FOB (US$)" fill="#8884d8" barSize={40} />
                    <Line yAxisId="right" type="monotone" dataKey="kg" name="Peso (KG)" stroke="#82ca9d" strokeWidth={3} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

        </div>
      )}
    </>
  );
}
