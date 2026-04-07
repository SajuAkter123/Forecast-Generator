import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  BarChart3, 
  TrendingUp, 
  Download, 
  Loader2, 
  FileSpreadsheet,
  AlertCircle,
  RefreshCw,
  PieChart as PieChartIcon,
  Table as TableIcon,
  Plus,
  Trash2,
  Wallet,
  Calendar,
  Zap
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  ReferenceLine,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line
} from 'recharts';
import { FileUpload } from './components/FileUpload';
import { SpreadsheetInput } from './components/SpreadsheetInput';
import { analyzeBankStatement } from './services/gemini';
import { generateForecast } from './services/forecast';
import { AnalysisResult, FileData, Transaction, MonthlySummary, SummaryRow, ForecastSettings, ForecastRow, Scenario, FutureEvent } from './types';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';

// --- Utilities ---

const COLORS = ['#16a34a', '#2563eb', '#9333ea', '#ea580c', '#dc2626', '#4b5563'];

const formatMonthSafe = (monthStr: string) => {
  if (!monthStr) return 'Unknown';
  
  // Handle YYYY-MM
  if (/^\d{4}-\d{2}$/.test(monthStr)) {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    if (!isNaN(date.getTime())) {
      return date.toLocaleString('default', { month: 'long', year: 'numeric' });
    }
  }
  
  // If it's already a descriptive string like "January 2025", return it
  return monthStr;
};

const formatMonthAbbr = (monthStr: string) => {
  if (!monthStr) return '';
  
  // Handle YYYY-MM
  if (/^\d{4}-\d{2}$/.test(monthStr)) {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    if (!isNaN(date.getTime())) {
      const fullMonth = date.toLocaleString('default', { month: 'long' });
      return fullMonth.substring(0, 2); // Ja, Fe, Ma, etc.
    }
  }
  
  // Handle Week labels like "Week 1 (24 Mar)"
  if (monthStr.startsWith('Week')) {
    const match = monthStr.match(/Week (\d+)/);
    return match ? `W${match[1]}` : monthStr;
  }
  
  // If it's already a descriptive string like "January 2025", take first two letters
  return monthStr.substring(0, 2);
};

const getMonthKey = (monthStr: string) => {
  if (!monthStr) return new Date().toISOString().substring(0, 7);
  
  // If already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(monthStr)) return monthStr;
  
  // Try to parse descriptive string
  const date = new Date(monthStr);
  if (!isNaN(date.getTime())) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  
  return monthStr; // Fallback
};

// --- Main Component ---

export default function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number, total: number } | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [pendingResult, setPendingResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'pdf' | 'spreadsheet'>('pdf');
  const [forecastSettings, setForecastSettings] = useState<ForecastSettings>({
    weeks: 13,
    incomeGrowth: 0,
    expenseGrowth: 0,
    startingBalance: 25000,
    scenario: 'base',
    futureEvents: []
  });

  const addFutureEvent = () => {
    const newEvent: FutureEvent = {
      id: Math.random().toString(36).substr(2, 9),
      label: 'New Event',
      amount: 0,
      type: 'expense',
      weekIndex: 0
    };
    setForecastSettings({
      ...forecastSettings,
      futureEvents: [...forecastSettings.futureEvents, newEvent]
    });
  };

  const updateFutureEvent = (id: string, field: keyof FutureEvent, value: any) => {
    let finalValue = value;
    if (field === 'amount') {
      finalValue = parseFloat(value) || 0;
    }
    setForecastSettings({
      ...forecastSettings,
      futureEvents: forecastSettings.futureEvents.map(e => e.id === id ? { ...e, [field]: finalValue } : e)
    });
  };

  const deleteFutureEvent = (id: string) => {
    setForecastSettings({
      ...forecastSettings,
      futureEvents: forecastSettings.futureEvents.filter(e => e.id !== id)
    });
  };

  const forecastData = useMemo(() => {
    if (!result || result.monthlySummaries.length < 2) return [];
    return generateForecast(result.monthlySummaries, forecastSettings);
  }, [result, forecastSettings]);

  const combinedChartData = useMemo(() => {
    if (!result) return [];
    const historical = result.monthlySummaries.map(m => ({
      month: m.month,
      income: m.income,
      expenses: m.expenses,
      netCash: m.netCash,
      isForecast: false
    }));

    if (forecastData.length === 0) return historical;

    // To make lines connect, the forecast line starts from the last historical point
    const lastHistorical = historical[historical.length - 1];
    const forecast = forecastData.map(f => ({
      month: f.week,
      forecastIncome: f.income,
      forecastExpenses: f.expenses,
      forecastNetCash: f.netCash,
      balance: f.balance,
      isForecast: true
    }));

    // Add the last historical point's values to the first forecast point's forecast keys
    // Or better, add a bridge point
    const bridge = {
      ...lastHistorical,
      forecastIncome: lastHistorical.income,
      forecastExpenses: lastHistorical.expenses,
      forecastNetCash: lastHistorical.netCash,
    };

    return [...historical.slice(0, -1), bridge, ...forecast];
  }, [result, forecastData]);

  const netCashOffset = useMemo(() => {
    if (combinedChartData.length === 0) return 0;
    const values = combinedChartData.flatMap(d => {
      const v1 = (d as any).netCash;
      const v2 = (d as any).forecastNetCash;
      return [v1, v2].filter((v): v is number => v !== undefined);
    });
    if (values.length === 0) return 0;
    const max = Math.max(...values);
    const min = Math.min(...values);

    if (max <= 0) return 0;
    if (min >= 0) return 1;

    return max / (max - min);
  }, [combinedChartData]);

  const handleUpload = async (files: FileData[]) => {
    setIsLoading(true);
    setProgress({ current: 0, total: Math.ceil(files.length / 3) }); // 3 is BATCH_SIZE
    setError(null);
    try {
      const analysis = await analyzeBankStatement(files, (current, total) => {
        setProgress({ current, total });
      });
      
      setPendingResult(analysis);
    } catch (err) {
      console.error(err);
      setError("Failed to analyze the statements. Please ensure they are valid PDF documents.");
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  };

  const handleSpreadsheetData = (data: SummaryRow[]) => {
    setPendingResult({
      transactions: [],
      monthlySummaries: [],
      summaryTable: data
    });
  };

  const addRow = () => {
    if (!pendingResult) return;
    const currentRows = pendingResult.summaryTable || pendingResult.monthlySummaries.map(m => ({
      month: m.month,
      monthKey: m.month,
      money_in: m.income,
      money_out: m.expenses,
      net_cash: m.netCash
    }));

    const newRow: SummaryRow = {
      month: 'New Month',
      monthKey: new Date().toISOString().substring(0, 7),
      money_in: 0,
      money_out: 0,
      net_cash: 0
    };

    setPendingResult({
      ...pendingResult,
      summaryTable: [...currentRows, newRow]
    });
  };

  const deleteRow = (index: number) => {
    if (!pendingResult) return;
    const currentRows = pendingResult.summaryTable || pendingResult.monthlySummaries.map(m => ({
      month: m.month,
      monthKey: m.month,
      money_in: m.income,
      money_out: m.expenses,
      net_cash: m.netCash
    }));

    const newTable = currentRows.filter((_, i) => i !== index);
    setPendingResult({
      ...pendingResult,
      summaryTable: newTable
    });
  };

  const confirmAnalysis = () => {
    if (!pendingResult) return;

    setResult(prev => {
      const currentTransactions = prev?.transactions || [];
      const currentSummaries = prev?.monthlySummaries || [];
      
      // Merge transactions and remove duplicates
      const allTransactions = [...currentTransactions, ...pendingResult.transactions];
      const uniqueTransactions = Array.from(new Map(
        allTransactions.map(t => [`${t.date}-${t.description}-${t.inflow}-${t.outflow}`, t])
      ).values());
      
      // Re-calculate monthly summaries
      const monthlyMap = new Map<string, { income: number, expenses: number }>();
      
      // 1. Start with transactions to get a baseline
      uniqueTransactions.forEach(t => {
        const current = monthlyMap.get(t.month) || { income: 0, expenses: 0 };
        current.income += t.inflow;
        current.expenses += t.outflow;
        monthlyMap.set(t.month, current);
      });

      // 2. Override with summaryTable if it exists (it's more authoritative for totals)
      const summaryRows = pendingResult.summaryTable || [];
      summaryRows.forEach(row => {
        const key = getMonthKey(row.monthKey || row.month);
        monthlyMap.set(key, { 
          income: row.money_in, 
          expenses: row.money_out 
        });
      });
      
      const monthlySummaries = Array.from(monthlyMap.entries())
        .map(([month, data]) => {
          const inc = data.income || 0;
          const exp = data.expenses || 0;
          return {
            month,
            income: inc,
            expenses: exp,
            netCash: inc - Math.abs(exp)
          };
        })
        .sort((a, b) => a.month.localeCompare(b.month));
        
      return {
        transactions: uniqueTransactions,
        monthlySummaries
      };
    });

    setPendingResult(null);
  };

  const updatePendingRow = (index: number, field: keyof SummaryRow, value: string) => {
    if (!pendingResult) return;
    
    const currentRows = pendingResult.summaryTable || pendingResult.monthlySummaries.map(m => ({
      month: m.month,
      monthKey: m.month,
      money_in: m.income,
      money_out: m.expenses,
      net_cash: m.netCash
    }));

    const newTable = [...currentRows];
    let numValue = parseFloat(value.replace(/[^0-9.-]/g, '')) || 0;
    
    newTable[index] = {
      ...newTable[index],
      [field]: field === 'month' || field === 'monthKey' ? value : numValue
    };

    // Recalculate net_cash if money_in or money_out changed
    if (field === 'money_in' || field === 'money_out') {
      newTable[index].net_cash = newTable[index].money_in - newTable[index].money_out;
    }

    setPendingResult({
      ...pendingResult,
      summaryTable: newTable
    });
  };

  const categoryData = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, number>();
    result.transactions.forEach(t => {
      if (t.outflow > 0) {
        map.set(t.category, (map.get(t.category) || 0) + t.outflow);
      }
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [result]);

  const downloadCSV = () => {
    if (!result || result.monthlySummaries.length === 0) return;
    const headers = ["Month", "Money In", "Money Out", "Net Cash Flow"];
    const rows = result.monthlySummaries.map(m => [
      m.month,
      m.income.toFixed(2),
      m.expenses.toFixed(2),
      m.netCash.toFixed(2)
    ]);
    
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `financial_summary_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportPDF = async () => {
    setIsGeneratingPdf(true);
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210;
      const pageHeight = 297;
      const marginLeft = 15;
      const marginRight = 15;
      const marginTop = 20;
      const marginBottom = 20;
      const contentWidth = pageWidth - marginLeft - marginRight;
      
      let currentY = marginTop;

      const sectionIds = [
        'pdf-title',
        'pdf-historical-table',
        'pdf-revenue-chart',
        'pdf-expense-chart',
        'pdf-forecast-chart',
        'pdf-balance-chart',
        'pdf-forecast-table'
      ];

      // Wait for everything to be ready
      await new Promise(resolve => setTimeout(resolve, 1500));

      let isFirstSection = true;
      for (let i = 0; i < sectionIds.length; i++) {
        const id = sectionIds[i];
        const element = document.getElementById(id);
        if (!element) continue;

        // Use toPng which handles modern CSS (oklch/oklab) much better than html2canvas
        const dataUrl = await toPng(element, {
          quality: 1,
          pixelRatio: 2,
          backgroundColor: '#ffffff',
          cacheBust: true,
        });

        if (!dataUrl || dataUrl === 'data:,') {
          console.warn(`Empty capture for ${id}`);
          continue;
        }

        const imgProps = pdf.getImageProperties(dataUrl);
        const imgWidth = contentWidth;
        const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

        // Check if we need a new page
        if (!isFirstSection && currentY + imgHeight > pageHeight - marginBottom) {
          pdf.addPage();
          currentY = marginTop;
        }

        pdf.addImage(dataUrl, 'PNG', marginLeft, currentY, imgWidth, imgHeight);
        currentY += imgHeight + 15; // Padding between sections
        isFirstSection = false;
      }

      pdf.save(`financial_forecast_report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("Failed to generate PDF. This is often due to modern color formats (oklab) not being supported by some capture engines. We have switched to a more compatible method.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const renderCustomLegend = (props: any) => {
    const { payload } = props;
    return (
      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[10px] font-bold text-zinc-500 mb-6 uppercase tracking-wider">
        {payload.map((entry: any, index: number) => {
          const isForecast = entry.dataKey.toLowerCase().includes('forecast');
          return (
            <li key={`item-${index}`} className="flex items-center gap-2">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <circle 
                  cx="5" 
                  cy="5" 
                  r="4" 
                  fill={isForecast ? "transparent" : entry.color} 
                  stroke={entry.color} 
                  strokeWidth="2"
                  strokeDasharray={isForecast ? "2 1" : "none"}
                />
              </svg>
              <span>{entry.value}</span>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <TrendingUp size={24} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Bank Statement Analyzer</h1>
              <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest">Financial Insights</p>
            </div>
          </div>
          
          {result && (
            <div className="flex items-center gap-3">
              <button 
                onClick={downloadCSV}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-all"
              >
                <FileSpreadsheet size={14} />
                Export CSV
              </button>
              <button 
                onClick={exportPDF}
                disabled={isGeneratingPdf}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-black rounded-lg transition-all shadow-md disabled:opacity-50"
              >
                {isGeneratingPdf ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {isGeneratingPdf ? 'Exporting...' : 'Export PDF'}
              </button>
              <button 
                onClick={reset}
                className="ml-2 flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-all"
                title="Clear All Data"
              >
                <RefreshCw size={14} />
                Clear All
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {pendingResult ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl mx-auto"
            >
              <div className="bg-white rounded-3xl border border-zinc-200 shadow-xl overflow-hidden">
                <div className="p-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                  <div>
                    <h2 className="text-2xl font-bold">Extraction Preview</h2>
                    <p className="text-sm text-zinc-500 mt-1">Please verify the extracted data before confirming.</p>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={addRow}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 font-bold text-sm hover:bg-zinc-50 transition-all"
                    >
                      <Plus size={16} />
                      Add Row
                    </button>
                    <button 
                      onClick={() => setPendingResult(null)}
                      className="px-6 py-2.5 rounded-xl border border-zinc-200 font-bold text-sm hover:bg-zinc-50 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={confirmAnalysis}
                      className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                    >
                      Confirm & Generate Dashboard
                    </button>
                  </div>
                </div>

                <div className="p-8">
                  <div className="overflow-hidden border border-zinc-100 rounded-2xl">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-zinc-50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                          <th className="px-6 py-4">Month</th>
                          <th className="px-6 py-4">Money In (£)</th>
                          <th className="px-6 py-4">Money Out (£)</th>
                          <th className="px-6 py-4">Net Cash Flow (£)</th>
                          <th className="px-6 py-4 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {(pendingResult.summaryTable || pendingResult.monthlySummaries.map(m => ({
                          month: m.month,
                          monthKey: m.month,
                          money_in: m.income,
                          money_out: m.expenses,
                          net_cash: m.netCash
                        }))).map((row, i) => (
                          <tr key={i} className="hover:bg-zinc-50 transition-colors group">
                            <td className="px-6 py-4">
                              <input 
                                type="text"
                                value={row.month}
                                onChange={(e) => updatePendingRow(i, 'month', e.target.value)}
                                className="bg-transparent border-none focus:ring-0 font-medium w-full"
                              />
                            </td>
                            <td className="px-6 py-4">
                              <input 
                                type="text"
                                value={row.money_in.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                onChange={(e) => updatePendingRow(i, 'money_in', e.target.value)}
                                className="bg-transparent border-none focus:ring-0 font-bold text-emerald-600 w-full"
                              />
                            </td>
                            <td className="px-6 py-4">
                              <input 
                                type="text"
                                value={row.money_out.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                onChange={(e) => updatePendingRow(i, 'money_out', e.target.value)}
                                className="bg-transparent border-none focus:ring-0 font-bold text-red-600 w-full"
                              />
                            </td>
                            <td className="px-6 py-4">
                              <span className={`font-bold ${row.net_cash >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                                £{(row.net_cash || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <button 
                                onClick={() => deleteRow(i)}
                                className="p-2 text-zinc-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-4 italic">* You can manually correct any number by clicking on it. Net Cash Flow is automatically recalculated.</p>
                </div>
              </div>
            </motion.div>
          ) : !result ? (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-2xl mx-auto mt-12"
            >
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold mb-3">Import Financial Data</h2>
                <p className="text-zinc-500">Upload bank statements or paste data directly from your spreadsheets.</p>
              </div>
              
              <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-xl shadow-zinc-200/50">
                <div className="flex p-1 bg-zinc-100 rounded-xl mb-8">
                  <button 
                    onClick={() => setActiveTab('pdf')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'pdf' ? 'bg-white text-indigo-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                  >
                    <Upload size={16} />
                    PDF Statements
                  </button>
                  <button 
                    onClick={() => setActiveTab('spreadsheet')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'spreadsheet' ? 'bg-white text-indigo-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                  >
                    <FileSpreadsheet size={16} />
                    Paste/Upload Table
                  </button>
                </div>

                {activeTab === 'pdf' ? (
                  <FileUpload onUpload={handleUpload} isLoading={isLoading} progress={progress} />
                ) : (
                  <SpreadsheetInput onDataLoaded={handleSpreadsheetData} />
                )}
                
                {error && (
                  <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600">
                    <AlertCircle size={20} />
                    <p className="text-sm font-medium">{error}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
                <div className="p-6 bg-white rounded-2xl border border-zinc-100 shadow-sm">
                  <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center mb-4">
                    <TableIcon size={20} />
                  </div>
                  <h3 className="font-bold mb-1">Data Extraction</h3>
                  <p className="text-xs text-zinc-500">AI-powered extraction of dates, descriptions, and amounts from complex PDFs.</p>
                </div>
                <div className="p-6 bg-white rounded-2xl border border-zinc-100 shadow-sm">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center mb-4">
                    <PieChartIcon size={20} />
                  </div>
                  <h3 className="font-bold mb-1">Smart Categorization</h3>
                  <p className="text-xs text-zinc-500">Automatic classification into Inventory, Marketing, Salaries, and more.</p>
                </div>
                <div className="p-6 bg-white rounded-2xl border border-zinc-100 shadow-sm">
                  <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-lg flex items-center justify-center mb-4">
                    <TrendingUp size={20} />
                  </div>
                  <h3 className="font-bold mb-1">Linear Forecasting</h3>
                  <p className="text-xs text-zinc-500">Advanced trend analysis to project your next 13 weeks of performance.</p>
                </div>
              </div>
            </motion.div>
          ) : (
            <div id="dashboard-content" className="space-y-12 pb-20">
              {/* Title Section for PDF */}
              <div id="pdf-title" className="pdf-only">
                <h1 className="text-3xl font-bold text-zinc-900 mb-2">Financial Forecast Report</h1>
                <p className="text-zinc-500">Generated on {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <div className="h-1 w-20 bg-indigo-600 mt-4 rounded-full"></div>
              </div>

              {/* Quick Upload for Appending */}
              <section className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                <FileUpload onUpload={handleUpload} isLoading={isLoading} progress={progress} compact />
              </section>

              {/* Historical Table */}
              <section id="pdf-historical-table" className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-zinc-900">Historical Performance</h3>
                    <p className="text-xs text-zinc-500 mt-1">Monthly summary of your actual financial data</p>
                  </div>
                  <span className="px-3 py-1 bg-zinc-100 text-zinc-700 text-[10px] font-bold rounded-full border border-zinc-200">
                    {result.monthlySummaries.length} MONTHS
                  </span>
                </div>
                <div>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-zinc-50/50 text-zinc-500 font-bold uppercase text-[9px] tracking-wider border-b border-zinc-100">
                        <th className="px-2 py-3">Month</th>
                        <th className="px-2 py-3">Money In</th>
                        <th className="px-2 py-3">Money Out</th>
                        <th className="px-2 py-3 text-right">Net Cash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {result.monthlySummaries.map((m, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-2 py-3 font-bold text-zinc-900 text-[10px]">{formatMonthSafe(m.month)}</td>
                          <td className="px-2 py-3 text-emerald-600 font-bold text-[10px]">£{(m.income || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-3 text-rose-600 font-bold text-[10px]">£{(m.expenses || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className={`px-2 py-3 text-right font-black text-[10px] ${m.netCash >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
                            £{(m.netCash || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Forecast Controls */}
              {result.monthlySummaries.length >= 2 && (
                <section className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-xl shadow-indigo-500/5 border-indigo-100">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                      <TrendingUp size={24} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-zinc-900">Forecast Engine</h2>
                      <p className="text-sm text-zinc-500">Adjust parameters to project future performance based on historical trends</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    <div className="space-y-2">
                      <label className="block text-sm font-bold text-zinc-700">
                        Forecast Horizon
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="1"
                          max="60"
                          value={forecastSettings.weeks}
                          onChange={(e) => setForecastSettings({ ...forecastSettings, weeks: parseInt(e.target.value) || 13 })}
                          className="w-full pl-4 pr-12 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-bold text-indigo-600"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400 uppercase">Weeks</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-bold text-zinc-700">
                        Starting Bank Balance
                      </label>
                      <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">£</div>
                        <input
                          type="number"
                          value={forecastSettings.startingBalance}
                          onChange={(e) => setForecastSettings({ ...forecastSettings, startingBalance: parseFloat(e.target.value) || 0 })}
                          className="w-full pl-8 pr-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-bold text-zinc-900"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-bold text-zinc-700">
                        Scenario Toggle
                      </label>
                      <div className="flex p-1 bg-zinc-100 rounded-xl">
                        {(['base', 'best', 'worst'] as Scenario[]).map((s) => (
                          <button
                            key={s}
                            onClick={() => setForecastSettings({ ...forecastSettings, scenario: s })}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all capitalize ${forecastSettings.scenario === s ? 'bg-white text-indigo-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="block text-sm font-bold text-zinc-700">
                        Income Growth Adjustment
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          value={forecastSettings.incomeGrowth}
                          onChange={(e) => setForecastSettings({ ...forecastSettings, incomeGrowth: parseFloat(e.target.value) || 0 })}
                          className="w-full pl-4 pr-12 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-bold text-emerald-600"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400 uppercase">%</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-2">
                      <label className="block text-sm font-bold text-zinc-700">
                        Expense Growth Adjustment
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          value={forecastSettings.expenseGrowth}
                          onChange={(e) => setForecastSettings({ ...forecastSettings, expenseGrowth: parseFloat(e.target.value) || 0 })}
                          className="w-full pl-4 pr-12 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-bold text-rose-600"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400 uppercase">%</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="block text-sm font-bold text-zinc-700">
                          One-Time Future Events
                        </label>
                        <button 
                          onClick={addFutureEvent}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                        >
                          <Plus size={14} /> Add Event
                        </button>
                      </div>
                      <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2">
                        {forecastSettings.futureEvents.map((event) => (
                          <div key={event.id} className="flex items-center gap-2 p-3 bg-zinc-50 rounded-xl border border-zinc-100 group">
                            <input 
                              type="text"
                              value={event.label}
                              onChange={(e) => updateFutureEvent(event.id, 'label', e.target.value)}
                              className="flex-1 bg-transparent border-none text-xs font-bold focus:ring-0 p-0"
                              placeholder="Event Name"
                            />
                            <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-lg px-2 py-1">
                              <span className="text-[10px] font-bold text-zinc-400">£</span>
                              <input 
                                type="number"
                                value={event.amount}
                                onChange={(e) => updateFutureEvent(event.id, 'amount', parseFloat(e.target.value) || 0)}
                                className="w-16 bg-transparent border-none text-xs font-bold focus:ring-0 p-0"
                              />
                            </div>
                            <select 
                              value={event.type}
                              onChange={(e) => updateFutureEvent(event.id, 'type', e.target.value)}
                              className="bg-white border border-zinc-200 rounded-lg text-[10px] font-bold px-2 py-1 focus:ring-0 outline-none"
                            >
                              <option value="income">Income</option>
                              <option value="expense">Expense</option>
                            </select>
                            <select 
                              value={event.weekIndex}
                              onChange={(e) => updateFutureEvent(event.id, 'weekIndex', parseInt(e.target.value))}
                              className="bg-white border border-zinc-200 rounded-lg text-[10px] font-bold px-2 py-1 focus:ring-0 outline-none"
                            >
                              {Array.from({ length: forecastSettings.weeks }).map((_, idx) => (
                                <option key={idx} value={idx}>Week {idx + 1}</option>
                              ))}
                            </select>
                            <button 
                              onClick={() => deleteFutureEvent(event.id)}
                              className="p-1 text-zinc-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        {forecastSettings.futureEvents.length === 0 && (
                          <p className="text-center py-4 text-xs text-zinc-400 italic">No future events added yet.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {result.monthlySummaries.length < 6 && (
                    <div className="mt-8 flex items-center gap-3 text-amber-700 bg-amber-50 p-4 rounded-2xl border border-amber-100 text-sm">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p><strong>Note:</strong> Smoothing (moving average) is disabled. Upload at least 6 months of historical data for more stable, smoothed projections.</p>
                    </div>
                  )}
                </section>
              )}

              {/* Charts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Income Chart */}
                <section id="pdf-revenue-chart" className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
                  <h3 className="text-xl font-bold text-zinc-900 mb-8">Income Trend & Forecast</h3>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          tickFormatter={formatMonthAbbr}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                          minTickGap={10}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          allowDataOverflow={true}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `£${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`}
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          formatter={(v: any) => [`£${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, '']}
                          labelFormatter={formatMonthSafe}
                        />
                        <Legend content={renderCustomLegend} verticalAlign="top" height={50} />
                        <Line 
                          type="monotone" 
                          dataKey="income" 
                          name="Historical Income" 
                          stroke="#16a34a" 
                          strokeWidth={4} 
                          dot={{ r: 4, fill: '#16a34a', strokeWidth: 2, stroke: '#fff' }}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="forecastIncome" 
                          name="Forecast Income" 
                          stroke="#16a34a" 
                          strokeWidth={4} 
                          strokeDasharray="8 8"
                          dot={{ r: 4, fill: '#fff', strokeWidth: 2, stroke: '#16a34a' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Expense Chart */}
                <section id="pdf-expense-chart" className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
                  <h3 className="text-xl font-bold text-zinc-900 mb-8">Expense Trend & Forecast</h3>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          tickFormatter={formatMonthAbbr}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                          minTickGap={10}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          allowDataOverflow={true}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `£${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`}
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          formatter={(v: any) => [`£${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, '']}
                          labelFormatter={formatMonthSafe}
                        />
                        <Legend content={renderCustomLegend} verticalAlign="top" height={50} />
                        <Line 
                          type="monotone" 
                          dataKey="expenses" 
                          name="Historical Expenses" 
                          stroke="#dc2626" 
                          strokeWidth={4} 
                          dot={{ r: 4, fill: '#dc2626', strokeWidth: 2, stroke: '#fff' }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="forecastExpenses" 
                          name="Forecast Expenses" 
                          stroke="#dc2626" 
                          strokeWidth={4} 
                          strokeDasharray="8 8"
                          dot={{ r: 4, fill: '#fff', strokeWidth: 2, stroke: '#dc2626' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Cash Flow Chart */}
                <section id="pdf-forecast-chart" className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm lg:col-span-2">
                  <h3 className="text-xl font-bold text-zinc-900 mb-8">Net Cash Flow & Forecast</h3>
                  <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedChartData}>
                        <defs>
                          <linearGradient id="netCashGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset={netCashOffset} stopColor="#16a34a" stopOpacity={1} />
                            <stop offset={netCashOffset} stopColor="#dc2626" stopOpacity={1} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          tickFormatter={formatMonthAbbr}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                          minTickGap={10}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          allowDataOverflow={true}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `£${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`}
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          formatter={(v: any) => [`£${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, '']}
                          labelFormatter={formatMonthSafe}
                        />
                        <Legend content={renderCustomLegend} verticalAlign="top" height={50} />
                        <ReferenceLine y={0} stroke="#1f2937" strokeWidth={2} />
                        <Line 
                          type="monotone" 
                          dataKey="netCash" 
                          name="Historical Net Cash" 
                          stroke="url(#netCashGradient)" 
                          strokeWidth={4} 
                          dot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="forecastNetCash" 
                          name="Forecast Net Cash" 
                          stroke="url(#netCashGradient)" 
                          strokeWidth={4} 
                          strokeDasharray="8 8" 
                          dot={{ r: 4, fill: '#fff', strokeWidth: 2, stroke: '#2563eb' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Bank Balance Chart */}
                <section id="pdf-balance-chart" className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm lg:col-span-2">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-bold text-zinc-900">Bank Balance Projection</h3>
                    <div className="flex items-center gap-2 px-3 py-1 bg-zinc-100 rounded-lg text-[10px] font-bold text-zinc-500 uppercase">
                      <Wallet size={12} />
                      Starting: £{forecastSettings.startingBalance.toLocaleString()}
                    </div>
                  </div>
                  <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedChartData.filter(d => d.isForecast)}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          tickFormatter={formatMonthAbbr}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                          minTickGap={10}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          allowDataOverflow={true}
                          tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `£${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`}
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          formatter={(v: any) => [`£${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Bank Balance']}
                          labelFormatter={(l) => l}
                        />
                        <ReferenceLine y={0} stroke="#dc2626" strokeWidth={2} strokeDasharray="3 3" />
                        <Line 
                          type="monotone" 
                          dataKey="balance" 
                          name="Projected Balance" 
                          stroke="#6366f1" 
                          strokeWidth={4} 
                          dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>

              {/* Tables Section */}
              <div className="grid grid-cols-1 gap-12">
                {/* Forecast Table */}
                {forecastData.length > 0 && (
                  <section id="pdf-forecast-table" className="bg-white rounded-3xl border border-indigo-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
                    <div className="p-4 border-b border-indigo-50 flex items-center justify-between bg-indigo-50/30">
                      <div>
                        <h3 className="text-lg font-bold text-indigo-900">Forecasted Performance</h3>
                        <p className="text-xs text-indigo-600/70 mt-1">Projected values based on linear regression and adjustments</p>
                      </div>
                      <span className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-full shadow-lg shadow-indigo-200">
                        {forecastData.length} WEEKS PROJECTION
                      </span>
                    </div>
                    <div>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-indigo-50/20 text-indigo-400 font-bold uppercase text-[8px] tracking-wider border-b border-indigo-50">
                            <th className="px-1.5 py-3">Week</th>
                            <th className="px-1.5 py-3">Forecast In</th>
                            <th className="px-1.5 py-3">Forecast Out</th>
                            <th className="px-1.5 py-3">Net Cash</th>
                            <th className="px-1.5 py-3 text-right">Bank Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-indigo-50">
                          {forecastData.map((f, i) => (
                            <tr key={i} className={`hover:bg-indigo-50/10 transition-colors ${f.isNegative ? 'bg-red-50/50' : ''}`}>
                              <td className="px-1.5 py-3 font-bold text-zinc-900 text-[9px]">
                                <div className="flex items-center gap-1">
                                  {f.isNegative && <AlertCircle size={8} className="text-red-600" />}
                                  {f.week}
                                </div>
                              </td>
                              <td className="px-1.5 py-3 text-emerald-600 font-bold italic text-[9px]">£{(f.income || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-1.5 py-3 text-rose-600 font-bold italic text-[9px]">£{(f.expenses || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className={`px-1.5 py-3 font-black italic text-[9px] ${f.netCash >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
                                £{(f.netCash || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className={`px-1.5 py-3 text-right font-black italic text-[9px] ${f.balance >= 0 ? 'text-zinc-900' : 'text-red-600'}`}>
                                £{(f.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>

            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
