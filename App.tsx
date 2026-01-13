import React, { useState, useEffect, useCallback } from 'react';
import NcmInput from './components/NcmInput.tsx';
import InfoDisplay from './components/InfoDisplay.tsx';
import DataTable from './components/DataTable.tsx';
import SimpleBarChart from './components/charts/SimpleBarChart.tsx';
import SimpleLineChart from './components/charts/SimpleLineChart.tsx';
import CombinedTradeBalanceChart from './components/charts/CombinedTradeBalanceChart.tsx';
import FileUpload from './components/FileUpload.tsx';
import Section from './components/Section.tsx';
import ReportCustomizer from './components/ReportCustomizer.tsx';
import RollingSumTooltip from './components/charts/RollingSumTooltip.tsx';
import SurgeAnalysisConfigurator from './components/SurgeAnalysisConfigurator.tsx';
import SurgeAnalysisDisplay from './components/SurgeAnalysisDisplay.tsx';

// ✅ Novo módulo (página mock)
import CgimAnalyticsPage from './components/CgimAnalyticsPage.tsx';

// Service imports
import { 
  fetchLastUpdateData, 
  fetchNcmDescription, 
  fetchNcmUnit, 
  fetchComexData,
  fetchMonthlyComexData,
  fetchCountryData
} from './services/comexApiService.ts';
import { 
  parseCgimDinteExcelForFiltering,
  parseNfeExcel
} from './services/excelService.ts';

// Utility imports
import { 
  processAnnualTradeData,
  createYearSummary,
  processNfeSalesData,
  processNfeCnaData,
  ensureVendasInternas,
  processRollingSumImportData,
  analyzeImportSurge
} from './utils/dataProcessing.ts';
import { formatIntegerPtBR, formatDecimalPtBR, formatNcmCode } from './utils/formatting.ts';

// Type imports
import { 
  LastUpdateData, NcmDetails, ProcessedTradeData, ApiFilter, Period, 
  CountryDataRecord, ChartDataPoint, CgimNcmInfo, EntityContactInfo, NfeData,
  YearSummaryData, FormattedNfeSalesData, FormattedNfeCnaData, SectionVisibility,
  RollingSumDataPoint, MonthlyComexStatRecord,
  SurgeAnalysisConfig, SurgeAnalysisResult
} from './types.ts';

type ActiveModule = "ncm" | "cgim";

const initialSectionVisibility: SectionVisibility = {
  showFullHistoricalData: true,
  showResumedHistoricalData: true,
  showAnnualVariationSummary: true,
  showAnnualCharts: true,
  showRollingSumImportChart: true,
  showCountryData: true,
  showExcelAnalysis: true,
  showSurgeAnalysis: true,
};

const App: React.FC = () => {
  // ✅ Estado do módulo (sem router, incremental e seguro)
  const [activeModule, setActiveModule] = useState<ActiveModule>("ncm");

  const [ncmCode, setNcmCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');

  const [lastUpdateData, setLastUpdateData] = useState<LastUpdateData | null>(null);
  const [ncmDetails, setNcmDetails] = useState<NcmDetails | null>(null);

  const [historicalTradeData, setHistoricalTradeData] = useState<ProcessedTradeData[]>([]);
  const [currentYearTradeData, setCurrentYearTradeData] = useState<ProcessedTradeData[]>([]);
  const [combinedTradeData, setCombinedTradeData] = useState<ProcessedTradeData[]>([]);
  const [resumedTradeData, setResumedTradeData] = useState<ProcessedTradeData[]>([]);

  const [importSummary, setImportSummary] = useState<YearSummaryData[]>([]);
  const [exportSummary, setExportSummary] = useState<YearSummaryData[]>([]);

  // Raw monthly data state
  const [rawMonthlyImportData, setRawMonthlyImportData] = useState<MonthlyComexStatRecord[]>([]);
  const [rollingSumImportData, setRollingSumImportData] = useState<RollingSumDataPoint[]>([]);
  const [monthlyApiDataIssue, setMonthlyApiDataIssue] = useState<boolean>(false);

  const [importCountryData, setImportCountryData] = useState<CountryDataRecord[]>([]);
  const [exportCountryData, setExportCountryData] = useState<CountryDataRecord[]>([]);

  const [cgimFile, setCgimFile] = useState<File | null>(null);
  const [nfeFile, setNfeFile] = useState<File | null>(null);
  const [parsedCgimData, setParsedCgimData] = useState<CgimNcmInfo | null>(null);
  const [parsedEntityContacts, setParsedEntityContacts] = useState<EntityContactInfo[]>([]);
  const [parsedNfeDataForNcm, setParsedNfeDataForNcm] = useState<NfeData[]>([]);
  const [nfeSalesTable, setNfeSalesTable] = useState<FormattedNfeSalesData[]>([]);
  const [nfeCnaTable, setNfeCnaTable] = useState<FormattedNfeCnaData[]>([]);

  const [sectionVisibility, setSectionVisibility] = useState<SectionVisibility>(initialSectionVisibility);

  // States for Surge Analysis
  const [surgeAnalysisResult, setSurgeAnalysisResult] = useState<SurgeAnalysisResult | null>(null);
  const [surgeCalculationLoading, setSurgeCalculationLoading] = useState<boolean>(false);

  const resetStateForNewNcm = () => {
    setLastUpdateData(null);
    setNcmDetails(null);
    setHistoricalTradeData([]);
    setCurrentYearTradeData([]);
    setCombinedTradeData([]);
    setResumedTradeData([]);
    setImportSummary([]);
    setExportSummary([]);
    setRawMonthlyImportData([]);
    setRollingSumImportData([]);
    setMonthlyApiDataIssue(false);
    setImportCountryData([]);
    setExportCountryData([]);
    setParsedCgimData(null);
    setParsedEntityContacts([]);
    setParsedNfeDataForNcm([]);
    setNfeSalesTable([]);
    setNfeCnaTable([]);
    setSurgeAnalysisResult(null);
  };

  const handleNcmSubmit = async (submittedNcmCode: string) => {
    setLoading(true);
    setNcmCode(submittedNcmCode);
    resetStateForNewNcm();

    setLoadingMessage('Carregando dados básicos do NCM...');
    const [updateData, desc, unit] = await Promise.all([
      fetchLastUpdateData(),
      fetchNcmDescription(submittedNcmCode),
      fetchNcmUnit(submittedNcmCode)
    ]);
    setLastUpdateData(updateData);
    const currentNcmDetails = { description: desc, unit: unit };
    setNcmDetails(currentNcmDetails);

    const filters: ApiFilter[] = [{ filter: "ncm", values: [submittedNcmCode] }];

    // Fetch all monthly data from 2019 up to API's last update.
    if (updateData.year && updateData.month) {
      setLoadingMessage('Carregando dados mensais (base para acumulado e surto)...');
      const monthlyPeriod: Period = { from: "2019-01", to: `${updateData.year}-${String(updateData.month).padStart(2, '0')}` };
      const fetchedMonthlyData = await fetchMonthlyComexData("import", monthlyPeriod, filters, ["metricFOB", "metricKG"]);

      if (fetchedMonthlyData && fetchedMonthlyData.length > 0) {
        setRawMonthlyImportData(fetchedMonthlyData);
        setMonthlyApiDataIssue(false);
        if (sectionVisibility.showRollingSumImportChart) {
          const processedRollingData = processRollingSumImportData(fetchedMonthlyData);
          setRollingSumImportData(processedRollingData);
        }
      } else {
        setRawMonthlyImportData([]);
        setMonthlyApiDataIssue(true);
        if (sectionVisibility.showRollingSumImportChart) setRollingSumImportData([]);
      }
    }

    if (sectionVisibility.showFullHistoricalData || sectionVisibility.showResumedHistoricalData || sectionVisibility.showAnnualVariationSummary || sectionVisibility.showAnnualCharts) {
      const historicalToYear = updateData.year ? updateData.year - 1 : new Date().getFullYear() - 1;
      const historicalPeriod: Period = { from: "2004-01", to: `${historicalToYear}-12` };

      setLoadingMessage('Carregando dados históricos anuais...');
      const histExportMetrics = ["metricFOB", "metricKG", "metricStatistic"];
      const histImportMetrics = ["metricFOB", "metricFreight", "metricInsurance", "metricCIF", "metricKG", "metricStatistic"];

      const [histExportDataRaw, histImportDataRaw] = await Promise.all([
        fetchComexData("export", historicalPeriod, filters, histExportMetrics, ["ncm"]),
        fetchComexData("import", historicalPeriod, filters, histImportMetrics, ["ncm"])
      ]);

      const processedHistData = processAnnualTradeData(histExportDataRaw, histImportDataRaw, submittedNcmCode, currentNcmDetails, updateData);
      setHistoricalTradeData(processedHistData);

      if (updateData.year && updateData.month) {
        setLoadingMessage('Carregando dados do ano corrente (anualizado)...');
        const currentYearPeriod: Period = { from: `${updateData.year}-01`, to: `${updateData.year}-${String(updateData.month).padStart(2, '0')}` };

        const [currentExportDataRaw, currentImportDataRaw] = await Promise.all([
          fetchComexData("export", currentYearPeriod, filters, histExportMetrics, ["ncm"]),
          fetchComexData("import", currentYearPeriod, filters, histImportMetrics, ["ncm"])
        ]);

        const processedCurrentData = processAnnualTradeData(currentExportDataRaw, currentImportDataRaw, submittedNcmCode, currentNcmDetails, updateData);
        setCurrentYearTradeData(processedCurrentData);

        const allData = [...processedHistData, ...processedCurrentData].sort((a, b) => parseInt(a.year.substring(0, 4)) - parseInt(b.year.substring(0, 4)));
        setCombinedTradeData(allData);

        const resumed = allData.map(d => ({
          year: d.year,
          'Exportações (US$ FOB)': d['Exportações (US$ FOB)'],
          'Exportações (KG)': d['Exportações (KG)'],
          'Importações (US$ FOB)': d['Importações (US$ FOB)'],
          'Importações (KG)': d['Importações (KG)'],
          'Balança Comercial (FOB)': d['Balança Comercial (FOB)'],
          'Balança Comercial (KG)': d['Balança Comercial (KG)'],
        } as ProcessedTradeData));
        setResumedTradeData(resumed);

        if (sectionVisibility.showAnnualVariationSummary) {
          setImportSummary(createYearSummary(allData, 'import'));
          setExportSummary(createYearSummary(allData, 'export'));
        }
      }
    }

    if (sectionVisibility.showCountryData) {
      setLoadingMessage('Carregando dados por país (2024)...');
      const [expCountries, impCountries] = await Promise.all([
        fetchCountryData(submittedNcmCode, "export", 2024),
        fetchCountryData(submittedNcmCode, "import", 2024)
      ]);
      setExportCountryData(expCountries);
      setImportCountryData(impCountries);
    }

    if (sectionVisibility.showExcelAnalysis) {
      if (cgimFile) await handleCgimFileUpload(cgimFile, submittedNcmCode, true);
      if (nfeFile) await handleNfeFileUpload(nfeFile, submittedNcmCode, true);
    }

    setLoadingMessage('');
    setLoading(false);
  };

  useEffect(() => {
    const fetchDataForNewlySelectedSections = async () => {
      if (!ncmCode || !lastUpdateData || !ncmDetails) return;

      setLoading(true);
      const filters: ApiFilter[] = [{ filter: "ncm", values: [ncmCode] }];

      if (rawMonthlyImportData.length === 0 && lastUpdateData.year && lastUpdateData.month) {
        setLoadingMessage('Carregando dados mensais (base para acumulado e surto)...');
        const monthlyPeriod: Period = { from: "2019-01", to: `${lastUpdateData.year}-${String(lastUpdateData.month).padStart(2, '0')}` };
        const fetchedMonthlyData = await fetchMonthlyComexData("import", monthlyPeriod, filters, ["metricFOB", "metricKG"]);
        if (fetchedMonthlyData && fetchedMonthlyData.length > 0) {
          setRawMonthlyImportData(fetchedMonthlyData);
          setMonthlyApiDataIssue(false);
        } else {
          setRawMonthlyImportData([]);
          setMonthlyApiDataIssue(true);
        }
      }

      if (sectionVisibility.showRollingSumImportChart && rawMonthlyImportData.length > 0 && rollingSumImportData.length === 0) {
        setLoadingMessage('Processando dados para gráfico de acumulado...');
        const processedRollingData = processRollingSumImportData(rawMonthlyImportData);
        setRollingSumImportData(processedRollingData);
      }

      if ((sectionVisibility.showFullHistoricalData || sectionVisibility.showResumedHistoricalData || sectionVisibility.showAnnualVariationSummary || sectionVisibility.showAnnualCharts) && combinedTradeData.length === 0) {
        setLoadingMessage('Carregando dados históricos/atuais anuais...');
        const historicalToYear = lastUpdateData.year ? lastUpdateData.year - 1 : new Date().getFullYear() - 1;
        const historicalPeriod: Period = { from: "2004-01", to: `${historicalToYear}-12` };
        const histExportMetrics = ["metricFOB", "metricKG", "metricStatistic"];
        const histImportMetrics = ["metricFOB", "metricFreight", "metricInsurance", "metricCIF", "metricKG", "metricStatistic"];

        const [histExportDataRaw, histImportDataRaw] = await Promise.all([
          fetchComexData("export", historicalPeriod, filters, histExportMetrics, ["ncm"]),
          fetchComexData("import", historicalPeriod, filters, histImportMetrics, ["ncm"])
        ]);
        const processedHistData = processAnnualTradeData(histExportDataRaw, histImportDataRaw, ncmCode, ncmDetails, lastUpdateData);
        setHistoricalTradeData(processedHistData);

        if (lastUpdateData.year && lastUpdateData.month) {
          const currentYearPeriod: Period = { from: `${lastUpdateData.year}-01`, to: `${lastUpdateData.year}-${String(lastUpdateData.month).padStart(2, '0')}` };
          const [currentExportDataRaw, currentImportDataRaw] = await Promise.all([
            fetchComexData("export", currentYearPeriod, filters, histExportMetrics, ["ncm"]),
            fetchComexData("import", currentYearPeriod, filters, histImportMetrics, ["ncm"])
          ]);
          const processedCurrentData = processAnnualTradeData(currentExportDataRaw, currentImportDataRaw, ncmCode, ncmDetails, lastUpdateData);
          setCurrentYearTradeData(processedCurrentData);

          const allData = [...processedHistData, ...processedCurrentData].sort((a, b) => parseInt(a.year.substring(0, 4)) - parseInt(b.year.substring(0, 4)));
          setCombinedTradeData(allData);

          const resumed = allData.map(d => ({
            year: d.year,
            'Exportações (US$ FOB)': d['Exportações (US$ FOB)'],
            'Exportações (KG)': d['Exportações (KG)'],
            'Importações (US$ FOB)': d['Importações (US$ FOB)'],
            'Importações (KG)': d['Importações (KG)'],
            'Balança Comercial (FOB)': d['Balança Comercial (FOB)'],
            'Balança Comercial (KG)': d['Balança Comercial (KG)'],
          } as ProcessedTradeData));
          setResumedTradeData(resumed);

          if (sectionVisibility.showAnnualVariationSummary && (importSummary.length === 0 && exportSummary.length === 0)) {
            setImportSummary(createYearSummary(allData, 'import'));
            setExportSummary(createYearSummary(allData, 'export'));
          }
        }
      }

      if (sectionVisibility.showCountryData && importCountryData.length === 0 && exportCountryData.length === 0) {
        setLoadingMessage('Carregando dados por país...');
        const [expCountries, impCountries] = await Promise.all([
          fetchCountryData(ncmCode, "export", 2024),
          fetchCountryData(ncmCode, "import", 2024)
        ]);
        setExportCountryData(expCountries);
        setImportCountryData(impCountries);
      }

      if (sectionVisibility.showExcelAnalysis) {
        if (cgimFile && (!parsedCgimData || parsedCgimData?.['NCM'] !== ncmCode) && parsedEntityContacts.filter(c => c.NCM === ncmCode).length === 0) {
          await handleCgimFileUpload(cgimFile, ncmCode, false);
        }
        if (nfeFile && parsedNfeDataForNcm.filter(d => d.ncm_8d === ncmCode).length === 0) {
          await handleNfeFileUpload(nfeFile, ncmCode, false);
        }
      }

      setLoading(false);
      setLoadingMessage('');
    };

    if (ncmCode) {
      fetchDataForNewlySelectedSections();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionVisibility, ncmCode]);

  const handleCgimFileUpload = useCallback(async (file: File, currentNcm: string | null = ncmCode, forceReprocess: boolean = false) => {
    if (!currentNcm) {
      setCgimFile(file);
      return;
    }
    if (!forceReprocess && parsedCgimData && parsedCgimData['NCM'] === currentNcm && parsedEntityContacts.some(c => c.NCM === currentNcm)) return;

    setLoading(true);
    setLoadingMessage('Processando arquivo CGIM/DINTE...');
    setCgimFile(file);
    try {
      const { cgimData, entityData } = await parseCgimDinteExcelForFiltering(file);
      const ncmInfo = cgimData.find(row => row['NCM'] === currentNcm);
      setParsedCgimData(ncmInfo || null);

      const contacts = entityData.filter(row => row['NCM'] === currentNcm);
      setParsedEntityContacts(contacts);

    } catch (error) {
      console.error("Error parsing CGIM/DINTE Excel:", error);
      alert(`Erro ao processar arquivo CGIM/DINTE: ${(error as Error).message}`);
      setParsedCgimData(null);
      setParsedEntityContacts([]);
    }
    setLoadingMessage('');
    setLoading(false);
  }, [ncmCode, parsedCgimData, parsedEntityContacts]);

  const handleNfeFileUpload = useCallback(async (file: File, currentNcm: string | null = ncmCode, forceReprocess: boolean = false) => {
    if (!currentNcm) {
      setNfeFile(file);
      return;
    }
    if (!forceReprocess && parsedNfeDataForNcm.some(d => d.ncm_8d === currentNcm)) return;

    setLoading(true);
    setLoadingMessage('Processando arquivo NFE...');
    setNfeFile(file);
    try {
      const allNfeData = await parseNfeExcel(file);
      const nfeForNcm = allNfeData.filter(row => row.ncm_8d === currentNcm);
      const nfeForNcmWithVendasInternas = ensureVendasInternas(nfeForNcm);
      setParsedNfeDataForNcm(nfeForNcmWithVendasInternas);

      if (nfeForNcmWithVendasInternas.length > 0) {
        setNfeSalesTable(processNfeSalesData(nfeForNcmWithVendasInternas));
        setNfeCnaTable(processNfeCnaData(nfeForNcmWithVendasInternas));
      } else {
        setNfeSalesTable([]);
        setNfeCnaTable([]);
      }

    } catch (error) {
      console.error("Error parsing NFE Excel:", error);
      alert(`Erro ao processar arquivo NFE: ${(error as Error).message}`);
      setParsedNfeDataForNcm([]);
      setNfeSalesTable([]);
      setNfeCnaTable([]);
    }
    setLoadingMessage('');
    setLoading(false);
  }, [ncmCode, parsedNfeDataForNcm]);

  const handleCalculateSurge = useCallback((config: SurgeAnalysisConfig) => {
    if (!rawMonthlyImportData || rawMonthlyImportData.length === 0) {
      setSurgeAnalysisResult({
        error: "Dados mensais não estão disponíveis. Verifique se o NCM foi carregado e a API retornou dados.",
        currentPeriod: {} as any, previousPeriods: [], averagePreviousKg: 0, percentageChange: 0, isSurge: false
      });
      return;
    }
    setSurgeCalculationLoading(true);
    try {
      const result = analyzeImportSurge(
        rawMonthlyImportData,
        config.startYear,
        config.startMonth,
        config.endYear,
        config.endMonth,
        lastUpdateData
      );
      setSurgeAnalysisResult(result);
    } catch (e) {
      console.error("Error during surge analysis calculation:", e);
      setSurgeAnalysisResult({
        error: `Erro ao calcular análise de surto: ${(e as Error).message}`,
        currentPeriod: {} as any, previousPeriods: [], averagePreviousKg: 0, percentageChange: 0, isSurge: false
      });
    }
    setSurgeCalculationLoading(false);
  }, [rawMonthlyImportData, lastUpdateData]);

  // Table definitions
  const tradeTableColumns = [
    { key: 'year', header: 'Ano', LTR: true },
    { key: 'Código NCM', header: 'NCM', LTR: true },
    { key: 'Descrição NCM', header: 'Descrição', LTR: true },
    { key: 'Unidade Estatística', header: 'Unidade Est.', LTR: true },
    { key: 'Exportações (US$ FOB)', header: 'Exp (US$ FOB)' },
    { key: 'Exportações (KG)', header: 'Exp (KG)' },
    { key: 'Exportações (Qtd Estatística)', header: 'Exp (Qtd Est.)' },
    { key: 'Importações (US$ FOB)', header: 'Imp (US$ FOB)' },
    { key: 'Importações (KG)', header: 'Imp (KG)' },
    { key: 'Importações (Qtd Estatística)', header: 'Imp (Qtd Est.)' },
    { key: 'Balança Comercial (FOB)', header: 'Balança (FOB)' },
    { key: 'Balança Comercial (KG)', header: 'Balança (KG)' },
    { key: 'Balança Comercial (Qtd Estatística)', header: 'Balança (Qtd Est.)' },
    { key: 'Importações (CIF USD)', header: 'Imp (CIF USD)' },
    { key: 'Importações (Frete USD)', header: 'Imp (Frete USD)' },
    { key: 'Importações (Seguro USD)', header: 'Imp (Seguro USD)' },
    { key: 'Preço Médio Exportação (US$ FOB/Ton)', header: 'Preço Médio Exp (US$/Ton)' },
    { key: 'Preço Médio Importação (US$ FOB/Ton)', header: 'Preço Médio Imp (US$/Ton)' },
    { key: 'Preço Médio Exportação (US$/KG)', header: 'Preço Médio Exp (US$/KG)' },
    { key: 'Preço Médio Importação (US$/KG)', header: 'Preço Médio Imp (US$/KG)' },
  ];
  const tradeTableFormatters = Object.fromEntries(
    tradeTableColumns.filter(c => !['year', 'Código NCM', 'Descrição NCM', 'Unidade Estatística'].includes(c.key))
      .map(c => [
        c.key,
        (c.key.includes('Preço Médio') || c.key.includes('US$/KG')) ? formatDecimalPtBR : formatIntegerPtBR
      ])
  );

  const resumedTableColumns = [
    { key: 'year', header: 'Ano', LTR: true },
    { key: 'Exportações (US$ FOB)', header: 'Exp (US$ FOB)' },
    { key: 'Exportações (KG)', header: 'Exp (KG)' },
    { key: 'Importações (US$ FOB)', header: 'Imp (US$ FOB)' },
    { key: 'Importações (KG)', header: 'Imp (KG)' },
    { key: 'Balança Comercial (FOB)', header: 'Balança (FOB)' },
    { key: 'Balança Comercial (KG)', header: 'Balança (KG)' },
  ];
  const resumedTableFormatters = Object.fromEntries(
    resumedTableColumns.filter(c => c.key !== 'year')
      .map(c => [c.key, formatIntegerPtBR])
  );

  const importSummaryColumns = [
    { key: 'Ano', header: 'Ano', LTR: true },
    { key: 'Importações (US$ FOB)', header: 'Imp (US$ FOB)' },
    { key: 'Var. (%) Imp (US$ FOB)', header: 'Var. (%) FOB' },
    { key: 'Importações (kg)', header: 'Imp (kg)' },
    { key: 'Var. (%) Imp (kg)', header: 'Var. (%) kg' },
    { key: 'Preço médio Importação (US$ FOB/Ton)', header: 'Preço Médio (US$/Ton)' },
    { key: 'Var. (%) Preço médio Imp', header: 'Var. (%) Preço Médio' },
  ];
  const importSummaryFormatters = {
    'Importações (US$ FOB)': formatIntegerPtBR,
    'Importações (kg)': formatIntegerPtBR,
    'Preço médio Importação (US$ FOB/Ton)': formatDecimalPtBR,
  };

  const exportSummaryColumns = [
    { key: 'Ano', header: 'Ano', LTR: true },
    { key: 'Exportações (US$ FOB)', header: 'Exp (US$ FOB)' },
    { key: 'Var. (%) Exp (US$ FOB)', header: 'Var. (%) FOB' },
    { key: 'Exportações (kg)', header: 'Exp (kg)' },
    { key: 'Var. (%) Exp (kg)', header: 'Var. (%) kg' },
    { key: 'Preço médio Exp (US$ FOB/Ton)', header: 'Preço Médio (US$/Ton)' },
    { key: 'Var. (%) Preço médio Exp', header: 'Var. (%) Preço Médio' },
  ];
  const exportSummaryFormatters = {
    'Exportações (US$ FOB)': formatIntegerPtBR,
    'Exportações (kg)': formatIntegerPtBR,
    'Preço médio Exp (US$ FOB/Ton)': formatDecimalPtBR,
  };

  const countryTableColumns = [
    { key: 'country', header: 'País', LTR: true },
    { key: 'metricFOB', header: 'Valor (US$ FOB)' },
    { key: 'metricKG', header: 'Peso (KG)' },
    { key: 'representatividadeFOB', header: 'Rep. FOB (%)' },
    { key: 'representatividadeKG', header: 'Rep. KG (%)' },
  ];
  const countryTableFormatters = {
    'metricFOB': formatIntegerPtBR,
    'metricKG': formatIntegerPtBR,
    'representatividadeFOB': (v: number) => formatDecimalPtBR(v) + '%',
    'representatividadeKG': (v: number) => formatDecimalPtBR(v) + '%',
  };

  const cgimNcmInfoColumns = [
    { key: 'NCM', header: 'NCM', LTR: true },
    { key: 'Departamento Responsável', header: 'Departamento Responsável', LTR: true },
    { key: 'Coordenação-Geral Responsável', header: 'Coordenação-Geral Responsável', LTR: true },
    { key: 'Agrupamento', header: 'Agrupamento', LTR: true },
    { key: 'Setores', header: 'Setores', LTR: true },
    { key: 'Subsetores', header: 'Subsetores', LTR: true },
    { key: 'Produtos', header: 'Produtos', LTR: true },
  ];

  const entityContactsColumns = [
    { key: 'Aba', header: 'Aba', LTR: true },
    { key: 'NCM', header: 'NCM', LTR: true },
    { key: 'Sigla Entidade', header: 'Sigla Entidade', LTR: true },
    { key: 'Entidade', header: 'Entidade', LTR: true },
    { key: 'Nome do Dirigente', header: 'Nome do Dirigente', LTR: true },
    { key: 'Cargo', header: 'Cargo', LTR: true },
    { key: 'E-mail', header: 'E-mail', LTR: true },
    { key: 'Telefone', header: 'Telefone', LTR: true },
    { key: 'Celular', header: 'Celular', LTR: true },
    { key: 'Contato Importante', header: 'Contato Importante', LTR: true },
    { key: 'Cargo (Contato Importante)', header: 'Cargo (Contato Importante)', LTR: true },
    { key: 'E-mail (Contato Importante)', header: 'E-mail (Contato Importante)', LTR: true },
    { key: 'Telefone (Contato Importante)', header: 'Telefone (Contato Importante)', LTR: true },
    { key: 'Celular (Contato Importante)', header: 'Celular (Contato Importante)', LTR: true },
  ];

  const nfeFullDataColumns = [
    { key: 'ano', header: 'Ano', LTR: true },
    { key: 'ncm_8d', header: 'NCM', LTR: true },
    { key: 'valor_producao', header: 'Valor Produção' },
    { key: 'qtd_tributavel_producao', header: 'Qtd Prod. Tributável' },
    { key: 'valor_exp', header: 'Valor Exp.' },
    { key: 'qtd_tributavel_exp', header: 'Qtd Exp. Tributável' },
    { key: 'valor_cif_imp_dolar', header: 'Valor Imp. CIF (US$)' },
    { key: 'qtd_tributavel_imp', header: 'Qtd Imp. Tributável' },
    { key: 'cambio_dolar_medio', header: 'Câmbio Médio (R$/US$)' },
    { key: 'valor_cif_imp_reais', header: 'Valor Imp. CIF (R$)' },
    { key: 'coeficiente_penetracao_imp_valor', header: 'Coef. Pen. Imp (Valor)' },
    { key: 'coeficiente_penetracao_imp_qtd', header: 'Coef. Pen. Imp (Qtd)' },
    { key: 'coeficiente_exp_valor', header: 'Coef. Exp (Valor)' },
    { key: 'coeficiente_exp_qtd', header: 'Coef. Exp (Qtd)' },
    { key: 'consumo_nacional_aparente_valor', header: 'CNA (Valor)' },
    { key: 'consumo_nacional_aparente_qtd', header: 'CNA (Qtd)' },
    { key: 'disponibilidade_total_valor', header: 'Disp. Total (Valor)' },
    { key: 'disponibilidade_total_qtd', header: 'Disp. Total (Qtd)' },
    { key: 'Vendas internas (KG)', header: 'Vendas Internas (KG)' },
  ];

  const nfeFullDataFormatters: Record<string, (value: any) => string> = {
    'valor_producao': formatIntegerPtBR,
    'qtd_tributavel_producao': formatIntegerPtBR,
    'valor_exp': formatIntegerPtBR,
    'qtd_tributavel_exp': formatIntegerPtBR,
    'valor_cif_imp_dolar': formatIntegerPtBR,
    'qtd_tributavel_imp': formatIntegerPtBR,
    'cambio_dolar_medio': formatDecimalPtBR,
    'valor_cif_imp_reais': formatIntegerPtBR,
    'coeficiente_penetracao_imp_valor': formatDecimalPtBR,
    'coeficiente_penetracao_imp_qtd': formatDecimalPtBR,
    'coeficiente_exp_valor': formatDecimalPtBR,
    'coeficiente_exp_qtd': formatDecimalPtBR,
    'consumo_nacional_aparente_valor': formatIntegerPtBR,
    'consumo_nacional_aparente_qtd': formatIntegerPtBR,
    'disponibilidade_total_valor': formatIntegerPtBR,
    'disponibilidade_total_qtd': formatIntegerPtBR,
    'Vendas internas (KG)': formatIntegerPtBR,
  };

  const nfeSalesTableColumns = [
    { key: 'ano', header: 'Ano', LTR: true },
    { key: 'Vendas totais (Kg)', header: 'Vendas Totais (Kg)', LTR: true },
    { key: 'Δ Vendas totais (%)', header: 'Δ Vendas Totais (%)', LTR: true },
    { key: 'Vendas internas (KG)', header: 'Vendas Internas (KG)', LTR: true },
    { key: 'Δ Vendas internas (%)', header: 'Δ Vendas Internas (%)', LTR: true },
    { key: 'Exportações (Kg)', header: 'Exportações (Kg)', LTR: true },
    { key: 'Δ Exportações (%)', header: 'Δ Exportações (%)', LTR: true },
  ];

  const nfeCnaTableColumns = [
    { key: 'ano', header: 'Ano', LTR: true },
    { key: 'Vendas internas (KG)', header: 'Vendas Internas (KG)', LTR: true },
    { key: 'Δ Vendas internas (%)', header: 'Δ Vendas Internas (%)', LTR: true },
    { key: 'Importações (Kg)', header: 'Importações (Kg)', LTR: true },
    { key: 'Δ Importações (%)', header: 'Δ Importações (%)', LTR: true },
    { key: 'CNA (Kg)', header: 'CNA (Kg)', LTR: true },
    { key: 'Δ CNA (%)', header: 'Δ CNA (%)', LTR: true },
    { key: 'Coeficiente de importação (%)', header: 'Coeficiente de Importação (%)', LTR: true },
  ];

  // Chart data preparation
  const chartDataKg = combinedTradeData
    .filter(d => parseInt(d.year.substring(0, 4)) >= 2010)
    .map(d => ({
      name: d.year,
      'Importações (KG)': d['Importações (KG)'],
      'Exportações (KG)': d['Exportações (KG)'],
    }));

  const chartDataFob = combinedTradeData
    .filter(d => parseInt(d.year.substring(0, 4)) >= 2010)
    .map(d => ({
      name: d.year,
      'Importações (US$ FOB)': d['Importações (US$ FOB)'],
      'Exportações (US$ FOB)': d['Exportações (US$ FOB)'],
    }));

  const chartDataPrices = combinedTradeData
    .filter(d => parseInt(d.year.substring(0, 4)) >= 2010)
    .map(d => ({
      name: d.year,
      'Preço Médio Importação (US$/KG)': d['Preço Médio Importação (US$/KG)'],
      'Preço Médio Exportação (US$/KG)': d['Preço Médio Exportação (US$/KG)'],
    }));

  const chartDataBalance: ChartDataPoint[] = combinedTradeData.map(d => ({
    name: d.year,
    'Exportações (US$ FOB)': d['Exportações (US$ FOB)'] || 0,
    'Importações (US$ FOB) Neg': -(d['Importações (US$ FOB)'] || 0),
    'Balança Comercial (FOB)': d['Balança Comercial (FOB)'] || 0,
  }));

  const chartDataForRollingSumKg: ChartDataPoint[] = rollingSumImportData.map(d => ({
    name: d.yearMonth,
    rollingKG: d.rollingKG,
  }));

  const barChartColors = (data: any[], index: number) => {
    if (index === data.length - 2) return 'sandybrown';
    if (index === data.length - 1) return 'darksalmon';
    return 'orange';
  };

  const barChartColorsExports = (data: any[], index: number) => {
    if (index === data.length - 2) return 'lightskyblue';
    if (index === data.length - 1) return 'lightsteelblue';
    return 'steelblue';
  };

  const showNoDataMessage = ncmCode && !loading &&
    (
      (!sectionVisibility.showFullHistoricalData && !sectionVisibility.showResumedHistoricalData && !sectionVisibility.showAnnualVariationSummary && !sectionVisibility.showAnnualCharts) ||
      combinedTradeData.length === 0
    ) &&
    (!sectionVisibility.showRollingSumImportChart || (rollingSumImportData.length === 0 && !monthlyApiDataIssue)) &&
    (!sectionVisibility.showCountryData || (importCountryData.length === 0 && exportCountryData.length === 0)) &&
    (!sectionVisibility.showExcelAnalysis || (
      (!cgimFile || (!parsedCgimData && parsedEntityContacts.length === 0)) &&
      (!nfeFile || parsedNfeDataForNcm.length === 0)
    )) &&
    (!sectionVisibility.showSurgeAnalysis || !surgeAnalysisResult || surgeAnalysisResult.error) &&
    (
      (sectionVisibility.showFullHistoricalData && combinedTradeData.length === 0) ||
      (sectionVisibility.showResumedHistoricalData && resumedTradeData.length === 0) ||
      (sectionVisibility.showAnnualVariationSummary && importSummary.length === 0 && exportSummary.length === 0) ||
      (sectionVisibility.showAnnualCharts && combinedTradeData.length === 0) ||
      (sectionVisibility.showRollingSumImportChart && rollingSumImportData.length === 0 && !monthlyApiDataIssue) ||
      (sectionVisibility.showCountryData && importCountryData.length === 0 && exportCountryData.length === 0)
    );

  return (
    <div className="container mx-auto p-4 md:p-8 bg-gray-50 min-h-screen">
      <header className="mb-6 text-center">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-700 py-2">
          Comexsetor
        </h1>
        <p className="text-gray-600 mt-1">
          Ferramenta para análise de comércio exterior (NCM) e análises setoriais (CGIM).
        </p>

        {/* ✅ Menu de módulos (incremental, sem router) */}
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            onClick={() => setActiveModule("ncm")}
            className={`px-4 py-2 rounded-md font-semibold border shadow-sm ${
              activeModule === "ncm"
                ? "bg-white border-blue-500 text-blue-700"
                : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Análises por NCM
          </button>
          <button
            onClick={() => setActiveModule("cgim")}
            className={`px-4 py-2 rounded-md font-semibold border shadow-sm ${
              activeModule === "cgim"
                ? "bg-white border-blue-500 text-blue-700"
                : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Análises CGIM (Setorial)
          </button>
        </div>
      </header>

      {/* ✅ Render do módulo CGIM sem interferir no módulo NCM */}
      {activeModule === "cgim" ? (
        <CgimAnalyticsPage />
      ) : (
        <>
          {!ncmCode && !loading && (
            <div className="text-center p-10 bg-white shadow-lg rounded-lg">
              <p className="text-xl text-gray-700">
                Por favor, insira um código NCM e selecione as seções desejadas no relatório para iniciar a análise.
              </p>
            </div>
          )}

          <NcmInput onSubmit={handleNcmSubmit} loading={loading} />
          <ReportCustomizer visibility={sectionVisibility} onVisibilityChange={setSectionVisibility} />

          {loading && loadingMessage && (
            <p className="text-center text-blue-600 my-4 p-3 bg-blue-50 rounded-md shadow">{loadingMessage}</p>
          )}

          {ncmCode && (
            <InfoDisplay ncmCode={ncmCode} lastUpdateData={lastUpdateData} ncmDetails={ncmDetails} appIsLoading={loading} />
          )}

          {ncmCode && !loading && (
            <>
              {sectionVisibility.showFullHistoricalData && combinedTradeData.length > 0 && (
                <Section title="Dados Históricos Consolidados (Comex Stat)" defaultOpen={false}>
                  <DataTable
                    title={`Dados Consolidados para NCM ${formatNcmCode(ncmCode)}`}
                    data={combinedTradeData}
                    columns={tradeTableColumns}
                    formatters={tradeTableFormatters}
                    source="Fonte: Comex Stat/MDIC. Elaboração própria."
                  />
                </Section>
              )}

              {sectionVisibility.showResumedHistoricalData && resumedTradeData.length > 0 && (
                <Section title="Dados Anuais Resumidos (Comex Stat)" defaultOpen={true}>
                  <DataTable
                    title={`Dados Resumidos para NCM ${formatNcmCode(ncmCode)}`}
                    data={resumedTradeData}
                    columns={resumedTableColumns}
                    formatters={resumedTableFormatters}
                    source="Fonte: Comex Stat/MDIC. Elaboração própria."
                  />
                </Section>
              )}

              {sectionVisibility.showAnnualVariationSummary && (importSummary.length > 0 || exportSummary.length > 0) && (
                <Section title="Quadros Resumo de Variação Anual (Importação e Exportação)" defaultOpen={true}>
                  {importSummary.length > 0 && (
                    <DataTable
                      title="Quadro Resumo das Importações (Variação Anual)"
                      data={importSummary}
                      columns={importSummaryColumns}
                      formatters={importSummaryFormatters}
                      source="Fonte: Comex Stat/MDIC. Elaboração própria."
                    />
                  )}
                  {exportSummary.length > 0 && (
                    <DataTable
                      title="Quadro Resumo das Exportações (Variação Anual)"
                      data={exportSummary}
                      columns={exportSummaryColumns}
                      formatters={exportSummaryFormatters}
                      source="Fonte: Comex Stat/MDIC. Elaboração própria."
                    />
                  )}
                </Section>
              )}

              {sectionVisibility.showAnnualCharts && combinedTradeData.length > 0 && (
                <Section title="Gráficos Anuais (Comex Stat)" defaultOpen={true}>
                  <div className="grid md:grid-cols-2 gap-6">
                    <SimpleBarChart
                      data={chartDataKg}
                      xAxisKey="name"
                      dataKey="Importações (KG)"
                      title={`Importações (KG) da NCM ${formatNcmCode(ncmCode)} (desde 2010)`}
                      yAxisLabel="Importações (KG)"
                      fillColor={(entry, index) => barChartColors(chartDataKg, index)}
                    />
                    <SimpleBarChart
                      data={chartDataFob}
                      xAxisKey="name"
                      dataKey="Importações (US$ FOB)"
                      title={`Importações (US$ FOB) da NCM ${formatNcmCode(ncmCode)} (desde 2010)`}
                      yAxisLabel="Importações (US$ FOB)"
                      fillColor={(entry, index) => barChartColors(chartDataFob, index)}
                    />
                    <SimpleBarChart
                      data={chartDataKg}
                      xAxisKey="name"
                      dataKey="Exportações (KG)"
                      title={`Exportações (KG) da NCM ${formatNcmCode(ncmCode)} (desde 2010)`}
                      yAxisLabel="Exportações (KG)"
                      fillColor={(entry, index) => barChartColorsExports(chartDataKg, index)}
                    />
                    <SimpleBarChart
                      data={chartDataFob}
                      xAxisKey="name"
                      dataKey="Exportações (US$ FOB)"
                      title={`Exportações (US$ FOB) da NCM ${formatNcmCode(ncmCode)} (desde 2010)`}
                      yAxisLabel="Exportações (US$ FOB)"
                      fillColor={(entry, index) => barChartColorsExports(chartDataFob, index)}
                    />
                  </div>
                  <SimpleLineChart
                    data={chartDataPrices}
                    xAxisKey="name"
                    lines={[
                      { dataKey: 'Preço Médio Importação (US$/KG)', name: 'Preço Médio Importação (US$/KG)', color: '#FF0000' },
                      { dataKey: 'Preço Médio Exportação (US$/KG)', name: 'Preço Médio Exportação (US$/KG)', color: '#0000FF' },
                    ]}
                    title={`Preços Médios de Importação e Exportação (US$/KG) da NCM ${formatNcmCode(ncmCode)} (desde 2010)`}
                    yAxisLabel="Preço Médio (US$/KG)"
                  />
                  <CombinedTradeBalanceChart
                    data={chartDataBalance}
                    title={`Exportação, Importação e Balança Comercial (US$ FOB) – NCM ${formatNcmCode(ncmCode)}`}
                  />
                </Section>
              )}

              {sectionVisibility.showRollingSumImportChart && (
                <Section title="Gráfico de Importação Acumulada (12 Meses)" defaultOpen={true}>
                  {rawMonthlyImportData.length > 0 && !monthlyApiDataIssue ? (
                    <SimpleBarChart
                      data={chartDataForRollingSumKg}
                      xAxisKey="name"
                      dataKey="rollingKG"
                      title={`Importação Acumulada (KG) nos Últimos 12 Meses - NCM ${formatNcmCode(ncmCode!)}`}
                      yAxisLabel="Quantidade Acumulada (KG)"
                      fillColor="steelblue"
                      customTooltip={<RollingSumTooltip />}
                      showLegend={false}
                    />
                  ) : monthlyApiDataIssue ? (
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-md text-center">
                      <p className="text-orange-700 font-semibold text-lg">
                        Não foi possível gerar o gráfico de importação acumulada.
                      </p>
                      <p className="text-gray-600 mt-2">
                        A API Comex Stat não retornou dados mensais válidos para o NCM{' '}
                        <span className="font-mono bg-gray-200 px-1 rounded">{formatNcmCode(ncmCode!)}</span>.
                      </p>
                    </div>
                  ) : (
                    <SimpleBarChart data={[]} xAxisKey="name" dataKey="rollingKG" title={`Importação Acumulada (KG) - NCM ${formatNcmCode(ncmCode!)}`} />
                  )}
                </Section>
              )}

              {sectionVisibility.showSurgeAnalysis && ncmCode && (
                <Section title="Análise de Surto de Importação" defaultOpen={true}>
                  <SurgeAnalysisConfigurator
                    onCalculate={handleCalculateSurge}
                    isLoading={surgeCalculationLoading}
                    lastUpdateData={lastUpdateData}
                  />
                  <SurgeAnalysisDisplay result={surgeAnalysisResult} isLoading={surgeCalculationLoading} />
                </Section>
              )}

              {sectionVisibility.showCountryData && (importCountryData.length > 0 || exportCountryData.length > 0) && (
                <Section title="Dados por País (2024)" defaultOpen={false}>
                  {importCountryData.length > 0 && (
                    <DataTable
                      title={`Principais Origens das Importações (2024) - NCM ${formatNcmCode(ncmCode)}`}
                      data={importCountryData}
                      columns={countryTableColumns}
                      formatters={countryTableFormatters}
                      source="Fonte: Comex Stat/MDIC. Elaboração própria."
                    />
                  )}
                  {exportCountryData.length > 0 && (
                    <DataTable
                      title={`Principais Destinos das Exportações (2024) - NCM ${formatNcmCode(ncmCode)}`}
                      data={exportCountryData}
                      columns={countryTableColumns}
                      formatters={countryTableFormatters}
                      source="Fonte: Comex Stat/MDIC. Elaboração própria."
                    />
                  )}
                </Section>
              )}
            </>
          )}

          {sectionVisibility.showExcelAnalysis && (
            <Section title="Análise de Arquivos Excel (Upload)" defaultOpen={!ncmCode}>
              <div className="grid md:grid-cols-2 gap-6 mb-6 p-4 border rounded-md bg-gray-50">
                <FileUpload
                  label="Arquivo CGIM/DINTE (NCMs-CGIM-DINTE.xlsx)"
                  onFileUpload={(file) => handleCgimFileUpload(file, ncmCode)}
                  acceptedFileTypes=".xlsx,.xls"
                  loading={loading && loadingMessage.includes('CGIM')}
                  fileName={cgimFile?.name}
                />
                <FileUpload
                  label="Arquivo NFE (dados_nfe_2016_2023.xlsx)"
                  onFileUpload={(file) => handleNfeFileUpload(file, ncmCode)}
                  acceptedFileTypes=".xlsx,.xls"
                  loading={loading && loadingMessage.includes('NFE')}
                  fileName={nfeFile?.name}
                />
              </div>

              {ncmCode && !loading && (
                <>
                  {cgimFile && parsedCgimData && (
                    <DataTable
                      title={`Informações CGIM/DINTE para NCM ${formatNcmCode(ncmCode)}`}
                      data={[parsedCgimData]}
                      columns={cgimNcmInfoColumns}
                      source="Fonte: Arquivo 20241011_NCMs-CGIM-DINTE.xlsx"
                    />
                  )}
                  {cgimFile && parsedCgimData === null && sectionVisibility.showExcelAnalysis && (
                    <p className="text-gray-600 p-3">
                      Nenhuma informação CGIM/DINTE encontrada para NCM {formatNcmCode(ncmCode)} no arquivo fornecido.
                    </p>
                  )}

                  {cgimFile && parsedEntityContacts.length > 0 && (
                    <DataTable
                      title={`Contatos de Entidades para NCM ${formatNcmCode(ncmCode)}`}
                      data={parsedEntityContacts}
                      columns={entityContactsColumns}
                      source="Fonte: Arquivo 20241011_NCMs-CGIM-DINTE.xlsx"
                    />
                  )}
                  {cgimFile && parsedEntityContacts.length === 0 && parsedCgimData !== undefined && sectionVisibility.showExcelAnalysis && (
                    <p className="text-gray-600 p-3">
                      Nenhum contato de entidade encontrado para NCM {formatNcmCode(ncmCode)} no arquivo fornecido.
                    </p>
                  )}

                  {nfeFile && parsedNfeDataForNcm.length > 0 && (
                    <>
                      <DataTable
                        title={`Dados Completos NFE para NCM ${formatNcmCode(ncmCode)}`}
                        data={parsedNfeDataForNcm}
                        columns={nfeFullDataColumns}
                        formatters={nfeFullDataFormatters}
                        source="Fonte: Planilha com dados da nota fiscal da RFB, disponibilizada pela SECEX"
                      />
                      <DataTable
                        title={`Vendas da Indústria Nacional - NCM ${formatNcmCode(ncmCode)}`}
                        data={nfeSalesTable}
                        columns={nfeSalesTableColumns}
                        source="Fonte: Planilha com dados da nota fiscal da RFB, disponibilizada pela SECEX"
                      />
                      <DataTable
                        title={`Consumo Nacional Aparente - NCM ${formatNcmCode(ncmCode)}`}
                        data={nfeCnaTable}
                        columns={nfeCnaTableColumns}
                        source="Fonte: Planilha com dados da nota fiscal da RFB, disponibilizada pela SECEX"
                      />
                    </>
                  )}
                  {nfeFile && parsedNfeDataForNcm.length === 0 && sectionVisibility.showExcelAnalysis && (
                    <p className="text-gray-600 p-3">
                      Nenhum dado NFE encontrado para NCM {formatNcmCode(ncmCode)} no arquivo fornecido.
                    </p>
                  )}
                </>
              )}
            </Section>
          )}

          {showNoDataMessage && (
            <div className="text-center p-10 bg-white shadow-lg rounded-lg mt-6">
              <p className="text-xl text-red-500">Nenhum dado encontrado para o NCM {formatNcmCode(ncmCode!)} nas seções selecionadas ou nos arquivos Excel fornecidos (se houver).</p>
              <p className="text-gray-600 mt-2">Verifique se o código NCM está correto ou tente outro código. Se estiver usando arquivos Excel, certifique-se de que eles contêm dados para o NCM informado e que a seção de análise de Excel está habilitada.</p>
            </div>
          )}

          <footer className="mt-12 text-center text-sm text-gray-500 py-4 border-t border-gray-300">
            <p>© {new Date().getFullYear()} Comexsetor. Desenvolvido como uma ferramenta de frontend.</p>
            <p>Todos os dados são provenientes da API Comex Stat do MDIC ou de arquivos Excel fornecidos pelo usuário.</p>
          </footer>
        </>
      )}
    </div>
  );
};

export default App;
