import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { ExcelImportRow, WatchedItem } from '../types';
import { calculateInventoryMetrics } from '../utils/calculations';
import { resolveSkuIds } from '../services/jubelioService';
import { saveWatchedItems } from '../services/firebaseService';
import { ArrowUpTrayIcon, CheckCircleIcon, PlayIcon } from '@heroicons/react/24/solid';

interface SettingsProps {
  token: string;
  onComplete: () => void;
}

const Settings: React.FC<SettingsProps> = ({ token, onComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'IDLE' | 'PARSING' | 'RESOLVING' | 'SAVING' | 'DONE'>('IDLE');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<WatchedItem[]>([]);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const processUpload = async () => {
    if (!file) return;
    setStatus('PARSING');
    addLog("Reading Excel file...");

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

        // Skip Header (Row 0)
        // Expected Columns based on requirements:
        // A: SKU, B: Nama, C: Variasi, D: HPP (Ignored), E: Loc (Ignored), F: Total Terjual (90 Hari), G: waktu restock
        
        const rows: ExcelImportRow[] = rawData.slice(1).map(r => ({
          sku: String(r[0] || '').trim(),
          name: String(r[1] || 'Unknown'),
          variation: String(r[2] || '').trim(),
          sold_90d: Number(r[5]) || 0,
          restock_days: Number(r[6]) || 0 // Assuming column G is index 6
        })).filter(r => r.sku.length > 0);

        if (rows.length === 0) {
          addLog("Error: No valid rows found.");
          setStatus('IDLE');
          return;
        }

        addLog(`Parsed ${rows.length} rows. Starting ID Resolution...`);
        setStatus('RESOLVING');

        // Resolve IDs
        const skus = rows.map(r => r.sku);
        const skuIdMap = await resolveSkuIds(token, skus, (curr, total) => {
          setProgress(Math.round((curr / total) * 100));
        });

        // Calculate Metrics
        addLog("Calculating inventory metrics...");
        const processedItems: WatchedItem[] = [];
        let missingIds = 0;

        rows.forEach(row => {
          const id = skuIdMap.get(row.sku);
          if (id) {
            processedItems.push(calculateInventoryMetrics(row, id));
          } else {
            missingIds++;
            addLog(`Warning: Could not resolve ID for SKU ${row.sku}`);
          }
        });

        addLog(`Processed ${processedItems.length} items successfully. (${missingIds} skipped)`);
        setPreviewData(processedItems);
        setStatus('SAVING');
        
        // Save to "Database"
        await saveWatchedItems(processedItems);
        addLog("Saved to Watchlist Database.");
        
        setStatus('DONE');
      } catch (e: any) {
        addLog(`Error: ${e.message}`);
        setStatus('IDLE');
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-gray-200">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Database Configuration</h2>
      
      <div className="mb-8">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Upload Quarterly Master Data (.xlsx)
        </label>
        <div className="flex items-center gap-4">
          <input 
            type="file" 
            accept=".xlsx"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <button
            onClick={processUpload}
            disabled={!file || status !== 'IDLE'}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'IDLE' ? <PlayIcon className="h-4 w-4" /> : <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
            Start Processing
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Columns required: SKU, Nama, Variasi, ..., Total Terjual (90 Hari), Waktu Restock (Hari)
        </p>
      </div>

      {status !== 'IDLE' && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
          <div className="flex justify-between text-sm font-medium mb-1">
            <span>Status: {status}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="h-32 overflow-y-auto font-mono text-xs text-gray-600 bg-white p-2 rounded border border-gray-200">
            {logs.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </div>
      )}

      {status === 'DONE' && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-green-600 font-bold text-lg mb-4">
            <CheckCircleIcon className="h-6 w-6" />
            Configuration Complete!
          </div>
          <br />
          <button 
            onClick={onComplete}
            className="bg-indigo-600 text-white px-8 py-3 rounded-lg hover:bg-indigo-700 font-medium shadow-sm transition-colors"
          >
            Go to Live Dashboard
          </button>
        </div>
      )}
    </div>
  );
};

export default Settings;
