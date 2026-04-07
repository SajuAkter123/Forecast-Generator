import { MonthlySummary, ForecastRow, ForecastSettings, Scenario } from '../types';

// 1. REMOVE OUTLIERS (one-time events)
function removeOutliers(arr: number[]): number[] {
  if (arr.length === 0) return [];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / arr.length;
  const std = Math.sqrt(variance);

  return arr.map(x => {
    if (std > 0 && Math.abs(x - mean) > 2 * std) {
      return mean; // replace extreme value
    }
    return x;
  });
}

// 2. TREND (Linear Regression)
function calculateLinearTrend(data: number[]) {
  const n = data.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  let x = [...Array(n).keys()];

  let sumX = x.reduce((a, b) => a + b, 0);
  let sumY = data.reduce((a, b) => a + b, 0);
  let sumXY = x.reduce((a, b, i) => a + b * data[i], 0);
  let sumXX = x.reduce((a, b) => a + b * b, 0);

  const denominator = (n * sumXX - sumX * sumX);
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

// 3. SEASONALITY INDEX
function calculateSeasonalIndex(data: number[]): number[] {
  const months = 12;
  let season = new Array(months).fill(0);
  let count = new Array(months).fill(0);

  data.forEach((val, i) => {
    let m = i % 12;
    season[m] += val;
    count[m]++;
  });

  return season.map((s, i) => (count[i] ? s / count[i] : 1));
}

// 4. RECENCY WEIGHTING
function calculateWeightedAvg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let total = 0;
  let weightSum = 0;

  arr.forEach((v, i) => {
    let w = i + 1; // recent gets higher weight
    total += v * w;
    weightSum += w;
  });

  return total / weightSum;
}

const REVENUE_ADJUSTMENT: Record<Scenario, number> = {
  base: 1,
  best: 1.10,
  worst: 0.90
};

const EXPENSE_ADJUSTMENT: Record<Scenario, number> = {
  base: 1,
  best: 1.08,
  worst: 0.92
};

export function generateForecast(
  historicalData: MonthlySummary[],
  settings: ForecastSettings
): ForecastRow[] {
  if (historicalData.length < 2) return [];

  let revenueHistory = historicalData.map(d => d.income);
  let expenseHistory = historicalData.map(d => d.expenses);

  // STEP 1: REMOVE OUTLIERS
  revenueHistory = removeOutliers(revenueHistory);
  expenseHistory = removeOutliers(expenseHistory);

  const n = historicalData.length;

  // STEP 2: TREND
  const revTrend = calculateLinearTrend(revenueHistory);
  const expTrend = calculateLinearTrend(expenseHistory);

  // STEP 3: SEASONALITY
  const revSeason = calculateSeasonalIndex(revenueHistory);
  const expSeason = calculateSeasonalIndex(expenseHistory);

  // STEP 4: RECENCY WEIGHTING
  const recentRev = calculateWeightedAvg(revenueHistory);
  const recentExp = calculateWeightedAvg(expenseHistory);

  const forecast: ForecastRow[] = [];
  
  // Start from the first day of the next month after the last historical month
  let lastMonthStr = historicalData[historicalData.length - 1].month;
  const [year, month] = lastMonthStr.split('-').map(Number);
  let currentDate = new Date(year, month, 1); 
  
  let currentBalance = settings.startingBalance;

  for (let i = 0; i < settings.weeks; i++) {
    // We calculate monthly base and then divide by 4.33 for weekly
    const t = n + Math.floor(i / 4.33);

    // Trend component
    let revBase = revTrend.intercept + revTrend.slope * t;
    let expBase = expTrend.intercept + expTrend.slope * t;

    // Seasonality
    let seasonFactorRev = revSeason[t % 12] / (recentRev || 1);
    let seasonFactorExp = expSeason[t % 12] / (recentExp || 1);

    // Combine
    let forecastRevMonthly = revBase * seasonFactorRev;
    let forecastExpMonthly = expBase * seasonFactorExp;

    // Prevent unrealistic negatives
    forecastRevMonthly = Math.max(0, forecastRevMonthly);
    forecastExpMonthly = Math.max(0, forecastExpMonthly);

    // Convert to weekly
    let inc = forecastRevMonthly / 4.33;
    let exp = forecastExpMonthly / 4.33;

    // Apply Scenario
    inc *= REVENUE_ADJUSTMENT[settings.scenario];
    exp *= EXPENSE_ADJUSTMENT[settings.scenario];

    // Apply manual growth adjustments from settings
    inc *= (1 + settings.incomeGrowth / 100);
    exp *= (1 + settings.expenseGrowth / 100);

    // Apply one-time events for this week
    const events = settings.futureEvents.filter(e => e.weekIndex === i);
    const incomeEvents = events.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
    const expenseEvents = events.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
    
    inc += incomeEvents;
    exp += Math.abs(expenseEvents);

    inc = Math.max(0, inc);
    exp = Math.max(0, exp);

    const net = inc - Math.abs(exp);
    currentBalance += net;

    const weekLabel = `Week ${i + 1} (${currentDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`;
    
    forecast.push({
      week: weekLabel,
      income: inc,
      expenses: exp,
      netCash: net,
      balance: currentBalance,
      isNegative: currentBalance < 0
    });

    currentDate.setDate(currentDate.getDate() + 7);
  }

  return forecast;
}
