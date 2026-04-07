import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Clipboard, FileSpreadsheet, AlertCircle, Trash2, Plus } from 'lucide-react';
import { SummaryRow } from '../types';

interface SpreadsheetInputProps {
  onDataLoaded: (data: SummaryRow[]) => void;
}

export function SpreadsheetInput({ onDataLoaded }: SpreadsheetInputProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const cleaned = String(val).replace(/[£$,\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const mapColumns = (headers: string[]): Record<string, number> => {
    const mapping: Record<string, number> = {
      month: -1,
      money_in: -1,
      money_out: -1,
      net_cash: -1
    };

    const monthAliases = ['month', 'date', 'period', 'week'];
    const inAliases = ['money in', 'revenue', 'inflow', 'cash in', 'income', 'deposits'];
    const outAliases = ['money out', 'expenses', 'outflow', 'cash out', 'spending', 'withdrawals'];
    const netAliases = ['net cash flow', 'net', 'profit', 'cash flow', 'net cash'];

    headers.forEach((h, i) => {
      const lower = h.toLowerCase().trim();
      if (monthAliases.some(a => lower.includes(a))) mapping.month = i;
      if (inAliases.some(a => lower.includes(a))) mapping.money_in = i;
      if (outAliases.some(a => lower.includes(a))) mapping.money_out = i;
      if (netAliases.some(a => lower.includes(a))) mapping.net_cash = i;
    });

    return mapping;
  };

  const processRawData = (rows: any[][]) => {
    if (rows.length < 2) {
      setError("Not enough data found. Please ensure you have a header row and at least one data row.");
      return;
    }

    const headers = rows[0].map(h => String(h));
    const mapping = mapColumns(headers);

    if (mapping.month === -1) {
      setError("Could not identify a 'Week' or 'Month' column. Please check your headers.");
      return;
    }

    const dataRows: SummaryRow[] = rows.slice(1).map(row => {
      const money_in = mapping.money_in !== -1 ? cleanNumber(row[mapping.money_in]) : 0;
      const money_out = mapping.money_out !== -1 ? cleanNumber(row[mapping.money_out]) : 0;
      let net_cash = mapping.net_cash !== -1 ? cleanNumber(row[mapping.net_cash]) : (money_in - money_out);
      
      // Validate net cash
      if (Math.abs(net_cash - (money_in - money_out)) > (Math.abs(money_in) * 0.01)) {
        net_cash = money_in - money_out;
      }

      const monthVal = String(row[mapping.month] || '');
      
      return {
        month: monthVal,
        monthKey: monthVal, // Parent will normalize this
        money_in,
        money_out,
        net_cash
      };
    }).filter(r => r.month);

    if (dataRows.length === 0) {
      setError("No valid data rows found.");
      return;
    }

    onDataLoaded(dataRows);
    setError(null);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;

    const lines = text.trim().split(/\r?\n/);
    const rows = lines.map(line => {
      if (line.includes('\t')) return line.split('\t');
      if (line.includes(',')) return line.split(',');
      return line.split(/\s{2,}/); // Fallback for multiple spaces
    });

    processRawData(rows);
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      processRawData(rows);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Paste Area */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-zinc-700 flex items-center gap-2">
            <Clipboard size={16} />
            Paste from Spreadsheet
          </label>
          <textarea
            onPaste={handlePaste}
            placeholder="Copy cells from Excel/Sheets and paste here...&#10;Week	Money In	Money Out	Net Cash Flow&#10;W01 2025	5000	4000	1000"
            className="w-full h-40 p-4 text-sm bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none font-mono"
          />
        </div>

        {/* Upload Area */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-zinc-700 flex items-center gap-2">
            <FileSpreadsheet size={16} />
            Upload Spreadsheet
          </label>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFileUpload(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`w-full h-40 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
              isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100'
            }`}
          >
            <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center text-zinc-400">
              <Upload size={24} />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold">Click or drag spreadsheet</p>
              <p className="text-xs text-zinc-500">Supports .csv, .xlsx, .xls</p>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
              accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
              className="hidden"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600">
          <AlertCircle size={20} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}
    </div>
  );
}
