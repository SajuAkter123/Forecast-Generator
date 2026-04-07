import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { AnalysisResult, FileData, Transaction } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const BATCH_SIZE = 3; // Process 3 files at a time to balance speed and reliability
const MAX_CONCURRENCY = 5; // Max parallel requests to avoid rate limits

async function analyzeBatch(files: FileData[], retryCount = 0): Promise<{ transactions: Transaction[], summaryTable: any[] }> {
  const model = "gemini-3.1-pro-preview";
  
  try {
    const fileParts = files.flatMap((file, index) => {
      const isPdf = file.mimeType === "application/pdf";
      // Ensure we only send the base64 part if it's a data URL
      const base64Data = file.data.includes('base64,') 
        ? file.data.split('base64,')[1] 
        : file.data;

      return [
        { text: `--- START OF DOCUMENT ${index + 1} ---` },
        isPdf 
          ? { inlineData: { data: base64Data, mimeType: file.mimeType } }
          : { text: `Bank Statement Content:\n${file.data}` },
        { text: `--- END OF DOCUMENT ${index + 1} ---` }
      ];
    });

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            ...fileParts,
            {
            text: `Extract financial data from EVERY document provided. You have been given ${files.length} documents in this batch.
              
              TASK 1: Extract ALL individual transactions.
              For each transaction, identify:
              - Date (YYYY-MM-DD)
              - Description
              - Money In (inflow)
              - Money Out (outflow)
              - Category (based on rules below)
              
              TASK 2: Extract the "Monthly Summary Table" if it exists.
              Look for a structured table with headers like: "Month", "Money In", "Money Out", "Net Cash Flow".
              
              CRITICAL EXTRACTION RULES:
              1. COLUMN ALIGNMENT: Use the horizontal position of column headers to determine column boundaries. All rows below must follow the same alignment. Use alignment rather than text order to assign values.
              2. EMPTY CELLS: If a value is missing between column boundaries, treat it as empty and assign 0 for numeric columns.
              3. NUMERIC CLEANING: For all amounts:
                 - Remove currency symbols (£, $, etc.)
                 - Remove commas and spaces
                 - Convert to a standard numeric value (e.g., £44,504.29 -> 44504.29)
              4. VALIDATION: For the summary table, verify that Net Cash Flow ≈ Money In - Money Out. If the difference is > 1%, recalculate it as Money In - Money Out.
              
              Return the data in the following JSON format:
              {
                "transactions": [
                  { 
                    "date": "YYYY-MM-DD", 
                    "month": "YYYY-MM", 
                    "year": number, 
                    "description": "string", 
                    "category": "string", 
                    "inflow": number, 
                    "outflow": number 
                  }
                ],
                "summaryTable": [
                  {
                    "month": "string (e.g. January 2025)",
                    "monthKey": "YYYY-MM",
                    "money_in": number,
                    "money_out": number,
                    "net_cash": number
                  }
                ]
              }
              
              Categorization rules for transactions:
              - "SHOP", "RETAIL", "SUPPLIER" -> Inventory
              - "TIKTOK", "META", "FACEBOOK", "ADS" -> Marketing
              - "PAYROLL", "SALARY", "STAFF" -> Salaries
              - "PARCEL", "DPD", "DHL", "COURIER" -> Shipping
              - "KLAVIYO", "ADOBE", "CANVA", "SHOPIFY" -> Software
              - Otherwise -> Other`
            }
          ]
        }
      ],
      config: {
        systemInstruction: "You are a professional financial data extractor. Your goal is to accurately extract transaction data and summary tables from bank statements. You MUST use column alignment to detect cells and handle empty numeric cells as 0. Ensure mathematical accuracy.",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  month: { type: Type.STRING },
                  year: { type: Type.NUMBER },
                  description: { type: Type.STRING },
                  category: { type: Type.STRING },
                  inflow: { type: Type.NUMBER },
                  outflow: { type: Type.NUMBER }
                },
                required: ["date", "month", "year", "description", "category", "inflow", "outflow"]
              }
            },
            summaryTable: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  month: { type: Type.STRING },
                  monthKey: { type: Type.STRING },
                  money_in: { type: Type.NUMBER },
                  money_out: { type: Type.NUMBER },
                  net_cash: { type: Type.NUMBER }
                },
                required: ["month", "monthKey", "money_in", "money_out", "net_cash"]
              }
            }
          },
          required: []
        }
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("No response from AI");
    
    const parsed = JSON.parse(resultText);
    return {
      transactions: parsed.transactions || [],
      summaryTable: parsed.summaryTable || []
    };
  } catch (error) {
    if (retryCount < 2) {
      console.warn(`Batch failed, retrying... (${retryCount + 1}/2)`, error);
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));
      return analyzeBatch(files, retryCount + 1);
    }
    throw error;
  }
}

export async function analyzeBankStatement(
  files: FileData[], 
  onProgress?: (current: number, total: number) => void
): Promise<AnalysisResult> {
  // Split files into batches
  const batches: FileData[][] = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    batches.push(files.slice(i, i + BATCH_SIZE));
  }

  const allTransactions: Transaction[] = [];
  const allSummaryRows: any[] = [];
  const totalBatches = batches.length;
  
  // Process batches sequentially for better reliability and accurate progress
  for (let i = 0; i < batches.length; i++) {
    try {
      const result = await analyzeBatch(batches[i]);
      allTransactions.push(...result.transactions);
      allSummaryRows.push(...result.summaryTable);
      
      if (onProgress) {
        onProgress(i + 1, totalBatches);
      }
    } catch (error) {
      console.error(`Failed to process batch ${i + 1}:`, error);
      // If a batch fails after retries, we continue with other batches if some data was already collected
      // or throw if it's the first batch and it failed.
      if (allTransactions.length === 0 && i === totalBatches - 1) {
        throw new Error("Failed to extract any data from the statements. Please check if the files are valid.");
      }
    }
  }

  if (allTransactions.length === 0 && allSummaryRows.length === 0) {
    throw new Error("No data was extracted from the provided files. Please ensure they are valid bank statements.");
  }
  
  // Post-process to aggregate weekly summaries
  const weeklyMap = new Map<string, { income: number, expenses: number }>();
  
  // 1. Process transactions
  allTransactions.forEach((t: any) => {
    // Calculate week key (YYYY-Www)
    const date = new Date(t.date);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const firstDayOfYear = new Date(year, 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
      const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;
      
      const current = weeklyMap.get(weekKey) || { income: 0, expenses: 0 };
      current.income += t.inflow;
      current.expenses += t.outflow;
      weeklyMap.set(weekKey, current);
    }
  });

  // 2. Merge summary rows (if they are monthly, we might need to distribute them, 
  // but usually if we have transactions we prefer those for weekly)
  if (allTransactions.length === 0) {
    allSummaryRows.forEach((row: any) => {
      const key = row.monthKey || row.month;
      weeklyMap.set(key, { 
        income: row.money_in, 
        expenses: row.money_out 
      });
    });
  }
  
  const monthlySummaries = Array.from(weeklyMap.entries())
    .map(([period, data]) => ({
      month: period, // Keeping the field name 'month' to avoid breaking types for now
      income: data.income,
      expenses: data.expenses,
      netCash: data.income - data.expenses
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    transactions: allTransactions,
    monthlySummaries,
    summaryTable: allSummaryRows.length > 0 ? allSummaryRows : undefined
  };
}
