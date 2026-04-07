export interface FileData {
  data: string;
  mimeType: string;
}

export interface Transaction {
  date: string;
  month: string;
  year: number;
  description: string;
  category: string;
  inflow: number;
  outflow: number;
}

export interface MonthlySummary {
  month: string; // e.g., "2024-01"
  income: number;
  expenses: number;
  netCash: number;
}

export interface ForecastData {
  month: string;
  forecastIncome: number;
  forecastExpenses: number;
  forecastNetCash: number;
}

export interface SummaryRow {
  month: string;
  monthKey: string;
  money_in: number;
  money_out: number;
  net_cash: number;
}

export type Scenario = 'base' | 'best' | 'worst';

export interface FutureEvent {
  id: string;
  label: string;
  amount: number;
  type: 'income' | 'expense';
  weekIndex: number; // Index in the forecast array
}

export interface ForecastRow {
  week: string;
  income: number;
  expenses: number;
  netCash: number;
  balance: number;
  isNegative: boolean;
}

export interface ForecastSettings {
  weeks: number;
  incomeGrowth: number;
  expenseGrowth: number;
  startingBalance: number;
  scenario: Scenario;
  futureEvents: FutureEvent[];
}

export interface AnalysisResult {
  transactions: Transaction[];
  monthlySummaries: MonthlySummary[];
  summaryTable?: SummaryRow[];
  forecast?: ForecastRow[];
}
