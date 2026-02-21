import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { WatchedItem, StockStatus, ExcelImportRow } from '../types';
import { resolveSkuIds } from '../services/jubelioService';
import { saveWatchedItems } from '../services/firebaseService';
import { calculateInventoryMetrics, getDaysToNextQuarter, getDaysOutOfStock } from '../utils/calculations';
import { 
  ArrowPathIcon, 
  FunnelIcon, 
  ArrowTrendingUpIcon, 
  ClockIcon,
  ArchiveBoxIcon,
  CloudArrowUpIcon,
  CheckCircleIcon,
  TruckIcon,
  NoSymbolIcon,
  ExclamationCircleIcon,
  CalendarDaysIcon
} from '@heroicons/react/24/outline';
import { PlayIcon } from '@heroicons/react/24/solid';

interface DashboardProps {
  items: WatchedItem[];
  refreshData: (itemsOverride?: WatchedItem[]) => void;
  isRefreshing: boolean;
  token: string;
  onItemsUpdated: (items: WatchedItem[]) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ items, refreshData, isRefreshing, token, onItemsUpdated }) => {
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showImporter, setShowImporter] = useState(false);
  const [quarterInfo, setQuarterInfo] = useState<{days: number, targetDate: string}>({ days: 0, targetDate: '' });

  // Importer State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<'IDLE' | 'PARSING' | 'RESOLVING' | 'SAVING' | 'DONE'>('IDLE');
  const [importProgress, setImportProgress] = useState(0);
  const [importLogs, setImportLogs] = useState<string[]>([]);

  useEffect(() => {
    setQuarterInfo(getDaysToNextQuarter());
  }, []);

  // Filter Logic
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesText = item.sku.toLowerCase().includes(filterText.toLowerCase()) || 
                          item.name.toLowerCase().includes(filterText.toLowerCase());
      
      let matchesStatus = true;
      if (statusFilter === 'REORDER') {
        matchesStatus = !!item.is_reordering;
      } else if (statusFilter !== 'ALL') {
        matchesStatus = item.status === statusFilter;
      }
      
      return matchesText && matchesStatus;
    });
  }, [items, filterText, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const counts = {
      total: items.length,
      [StockStatus.NORMAL]: 0,
      [StockStatus.LOW_STOCK]: 0,
      [StockStatus.OUT_OF_STOCK]: 0,
      [StockStatus.OVERSTOCK]: 0,
      [StockStatus.SUPPLIER_EMPTY]: 0,
      reordering: 0
    };
    items.forEach(i => {
      if (counts[i.status] !== undefined) counts[i.status]++;
      if (i.is_reordering) counts.reordering++;
    });
    return counts;
  }, [items]);

  // --- ACTIONS ---
  const handleToggleReorder = async (item: WatchedItem) => {
    const updated = items.map(i => i.item_id === item.item_id ? { ...i, is_reordering: !i.is_reordering } : i);
    onItemsUpdated(updated);
    await saveWatchedItems(updated);
  };

  const handleSetSupplierEmpty = async (item: WatchedItem) => {
    // Toggle: If already Supplier Empty, revert to Out of Stock or calculate based on count (usually OOS if 0)
    const newStatus = item.status === StockStatus.SUPPLIER_EMPTY ? StockStatus.OUT_OF_STOCK : StockStatus.SUPPLIER_EMPTY;
    const updated = items.map(i => i.item_id === item.item_id ? { ...i, status: newStatus } : i);
    onItemsUpdated(updated);
    await saveWatchedItems(updated);
  };

  // --- IMPORTER LOGIC ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setImportFile(e.target.files[0]);
  };

  const startImport = async () => {
    if (!importFile) return;
    setImportStatus('PARSING');
    setImportLogs(["Membaca file Excel..."]);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        
        const rows: ExcelImportRow[] = rawData.slice(1).map(r => ({
          sku: String(r[0] || '').trim(),
          name: String(r[1] || 'Unknown'),
          variation: String(r[2] || '').trim(),
          sold_90d: Number(r[5]) || 0,
          restock_days: Number(r[6]) || 0,
          waktu_restock_desc: String(r[7] || '') 
        })).filter(r => r.sku.length > 0);

        if (rows.length === 0) throw new Error("Tidak ada baris valid ditemukan.");

        setImportLogs(prev => [...prev, `Ditemukan ${rows.length} SKU. Memulai resolusi ID...`]);
        setImportStatus('RESOLVING');

        const skus = rows.map(r => r.sku);
        const skuIdMap = await resolveSkuIds(token, skus, (curr, total) => {
          setImportProgress(Math.round((curr / total) * 100));
        });

        setImportLogs(prev => [...prev, "Menghitung metrik inventaris..."]);
        const processedItems: WatchedItem[] = [];
        
        rows.forEach(row => {
          const id = skuIdMap.get(row.sku);
          if (id) processedItems.push(calculateInventoryMetrics(row, id));
        });

        setImportLogs(prev => [...prev, `Berhasil memproses ${processedItems.length} item.`]);
        setImportStatus('SAVING');
        
        await saveWatchedItems(processedItems);
        onItemsUpdated(processedItems);
        setImportStatus('DONE');

        // Auto-fetch live stock after import using the new items
        setImportLogs(prev => [...prev, "Mengambil data stok terbaru..."]);
        refreshData(processedItems);
        
      } catch (e: any) {
        setImportLogs(prev => [...prev, `Error: ${e.message}`]);
        setImportStatus('IDLE');
      }
    };
    reader.readAsBinaryString(importFile);
  };

  // --- RENDER HELPERS ---
  const getRowClass = (status: StockStatus) => {
    switch (status) {
      case StockStatus.LOW_STOCK: return 'bg-yellow-50 hover:bg-yellow-100';
      case StockStatus.OUT_OF_STOCK: return 'bg-red-50 hover:bg-red-100';
      case StockStatus.SUPPLIER_EMPTY: return 'bg-gray-100 hover:bg-gray-200 text-gray-500';
      default: return 'hover:bg-gray-50';
    }
  };

  const StatusTile = ({ label, count, active, onClick, colorClass }: any) => (
    <button 
      onClick={onClick}
      className={`p-3 rounded-xl border flex flex-col items-start justify-between transition-all shadow-sm
        ${active ? 'ring-2 ring-blue-500 transform scale-105' : 'hover:shadow-md'}
        ${colorClass}
      `}
    >
      <span className="text-xs font-semibold uppercase opacity-70">{label}</span>
      <span className="text-2xl font-bold mt-1">{count}</span>
    </button>
  );

  return (
    <div className="space-y-6">
      
      {/* HEADER & COUNTDOWN */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-gradient-to-r from-blue-900 to-blue-700 p-6 rounded-xl shadow-lg text-white">
        <div>
          <h2 className="text-2xl font-bold">Top 200 SKU Watchlist</h2>
          <p className="text-blue-200 text-sm mt-1">Dashboard monitoring stok prioritas</p>
        </div>
        <div className="mt-4 md:mt-0 bg-white/10 backdrop-blur-sm p-3 rounded-lg border border-white/20 text-center">
          <div className="text-xs text-blue-100 uppercase tracking-wide mb-1">Reset Kuartal Berikutnya</div>
          <div className="flex items-center justify-center gap-2">
            <ClockIcon className="h-5 w-5 text-yellow-300" />
            <span className="text-xl font-mono font-bold">{quarterInfo.days} Hari Lagi</span>
          </div>
          <div className="text-[10px] text-blue-200 mt-1">{quarterInfo.targetDate}</div>
        </div>
      </div>

      {/* MINI DASHBOARD TILES */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatusTile 
          label="Total SKU" 
          count={stats.total} 
          active={statusFilter === 'ALL'} 
          onClick={() => setStatusFilter('ALL')}
          colorClass="bg-white border-gray-200 text-gray-800"
        />
        <StatusTile 
          label="Sedang Re-order" 
          count={stats.reordering} 
          active={statusFilter === 'REORDER'} 
          onClick={() => setStatusFilter('REORDER')}
          colorClass="bg-blue-50 border-blue-200 text-blue-800"
        />
        <StatusTile 
          label="Aman" 
          count={stats[StockStatus.NORMAL] + stats[StockStatus.OVERSTOCK]} 
          active={statusFilter === StockStatus.NORMAL} 
          onClick={() => setStatusFilter(StockStatus.NORMAL)}
          colorClass="bg-green-50 border-green-200 text-green-800"
        />
        <StatusTile 
          label="Stok Menipis" 
          count={stats[StockStatus.LOW_STOCK]} 
          active={statusFilter === StockStatus.LOW_STOCK} 
          onClick={() => setStatusFilter(StockStatus.LOW_STOCK)}
          colorClass="bg-yellow-50 border-yellow-200 text-yellow-800"
        />
        <StatusTile 
          label="Stok Habis" 
          count={stats[StockStatus.OUT_OF_STOCK]} 
          active={statusFilter === StockStatus.OUT_OF_STOCK} 
          onClick={() => setStatusFilter(StockStatus.OUT_OF_STOCK)}
          colorClass="bg-red-50 border-red-200 text-red-800"
        />
         <StatusTile 
          label="Supplier Kosong" 
          count={stats[StockStatus.SUPPLIER_EMPTY]} 
          active={statusFilter === StockStatus.SUPPLIER_EMPTY} 
          onClick={() => setStatusFilter(StockStatus.SUPPLIER_EMPTY)}
          colorClass="bg-gray-100 border-gray-300 text-gray-600"
        />
      </div>

      {/* IMPORTER TOGGLE */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button 
          onClick={() => setShowImporter(!showImporter)}
          className="w-full flex justify-between items-center p-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 font-semibold text-gray-700">
            <CloudArrowUpIcon className="h-5 w-5 text-blue-600" />
            Update Database (Excel Master)
          </div>
          <span className="text-blue-600 text-sm">{showImporter ? 'Tutup' : 'Buka'}</span>
        </button>
        
        {showImporter && (
          <div className="p-4 border-t border-gray-200 bg-gray-50 animate-fade-in">
             <div className="flex flex-col md:flex-row gap-4 items-end">
               <div className="w-full md:w-auto flex-1">
                 <label className="block text-xs font-medium text-gray-500 mb-1">File Excel (.xlsx)</label>
                 <input type="file" accept=".xlsx" onChange={handleFileChange} className="block w-full text-sm border rounded bg-white" />
               </div>
               <button 
                 onClick={startImport} 
                 disabled={!importFile || (importStatus !== 'IDLE' && importStatus !== 'DONE')}
                 className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
               >
                 {importStatus === 'IDLE' || importStatus === 'DONE' ? <PlayIcon className="h-4 w-4" /> : <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
                 Proses Upload
               </button>
             </div>
             {importLogs.length > 0 && (
               <div className="mt-4 p-3 bg-black text-green-400 text-xs font-mono rounded max-h-32 overflow-y-auto">
                 {importLogs.map((log, i) => <div key={i}>{log}</div>)}
                 {importStatus === 'DONE' && <div className="text-white mt-2 font-bold">✓ Selesai! Data berhasil diperbarui.</div>}
               </div>
             )}
          </div>
        )}
      </div>

      {/* CONTROLS & SEARCH */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 sticky top-4 z-20">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="relative w-full md:w-96">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Cari SKU atau Nama..."
              className="pl-10 block w-full rounded-lg border-gray-300 bg-gray-50 border focus:ring-blue-500 focus:border-blue-500 sm:text-sm p-2.5"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <button 
              onClick={() => refreshData()} 
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-75 ${isRefreshing ? 'cursor-not-allowed' : ''}`}
              disabled={isRefreshing}
            >
              <ArrowPathIcon className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Update Stok (Live)
            </button>
          </div>
        </div>
      </div>

      {/* MAIN TABLE */}
      <div className="hidden md:block overflow-hidden rounded-xl shadow-sm border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU / Nama</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lead Time (Hari)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Jual (90 Hari)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Kesehatan Stok</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredItems.map((item) => (
              <tr key={item.item_id} className={`${getRowClass(item.status)} transition-colors`}>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">{item.sku}</span>
                      {item.is_reordering && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          <TruckIcon className="h-3 w-3 mr-1" /> Re-order
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 truncate max-w-xs" title={item.name}>{item.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  <div className="flex items-center">
                    <ClockIcon className="h-4 w-4 mr-1 text-gray-400" />
                    {item.restock_time} Hari
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <div className="flex items-center">
                    <ArrowTrendingUpIcon className="h-4 w-4 text-gray-400 mr-2" />
                    {item.total_sold_90d}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex flex-col gap-1 text-sm">
                     <div className="flex justify-between w-32">
                       <span className="text-gray-500">Stok:</span>
                       <span className="font-bold text-gray-900">{item.actual_stock}</span>
                     </div>
                     <div className="flex justify-between w-32 text-xs">
                       <span className="text-gray-400">Target:</span>
                       <span className="text-blue-600 font-medium">{item.target_stock}</span>
                     </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex flex-col items-start gap-1">
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-bold rounded-full border bg-white border-opacity-20
                      ${item.status === StockStatus.NORMAL ? 'text-green-800 border-green-200' : 
                        item.status === StockStatus.LOW_STOCK ? 'text-yellow-800 border-yellow-200' :
                        item.status === StockStatus.OUT_OF_STOCK ? 'text-red-800 border-red-200' :
                        item.status === StockStatus.SUPPLIER_EMPTY ? 'text-gray-600 border-gray-400' : ''
                      }`}>
                      {item.status}
                    </span>
                    {item.status === StockStatus.OUT_OF_STOCK && item.out_of_stock_since && (
                      <span className="text-[10px] text-red-600 font-medium bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                        {getDaysOutOfStock(item.out_of_stock_since)} hari kosong
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <div className="flex justify-center gap-2">
                    <button 
                      onClick={() => handleToggleReorder(item)}
                      title="Tandai Sedang Re-order"
                      className={`p-1 rounded-md transition-colors ${item.is_reordering ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                    >
                      <TruckIcon className="h-5 w-5" />
                    </button>
                    <button 
                      onClick={() => handleSetSupplierEmpty(item)}
                      title="Tandai Supplier Kosong"
                      className={`p-1 rounded-md transition-colors ${item.status === StockStatus.SUPPLIER_EMPTY ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-800 hover:bg-gray-200'}`}
                    >
                      <NoSymbolIcon className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MOBILE CARD VIEW */}
      <div className="block md:hidden space-y-3">
        {filteredItems.map(item => (
          <div key={item.item_id} className={`p-4 rounded-xl border shadow-sm ${getRowClass(item.status)}`}>
             <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-bold text-gray-900">{item.sku}</h3>
                  <p className="text-xs text-gray-500 line-clamp-1">{item.name}</p>
                </div>
                <div className="flex gap-1">
                   {item.is_reordering && <TruckIcon className="h-5 w-5 text-blue-600" />}
                   {item.status === StockStatus.SUPPLIER_EMPTY && <NoSymbolIcon className="h-5 w-5 text-gray-500" />}
                </div>
             </div>
             
             <div className="flex justify-between items-center bg-white/50 p-2 rounded-lg mb-3">
                <div className="text-center">
                   <div className="text-[10px] text-gray-500 uppercase">Stok</div>
                   <div className="font-bold text-lg">{item.actual_stock}</div>
                </div>
                <div className="text-center">
                   <div className="text-[10px] text-gray-500 uppercase">Target</div>
                   <div className="text-blue-600 font-bold">{item.target_stock}</div>
                </div>
                <div className="text-center">
                   <div className="text-[10px] text-gray-500 uppercase">Status</div>
                   <div className="text-xs font-bold">{item.status}</div>
                   {item.status === StockStatus.OUT_OF_STOCK && item.out_of_stock_since && (
                     <div className="text-[9px] text-red-600 mt-0.5 font-medium">
                       {getDaysOutOfStock(item.out_of_stock_since)} hari
                     </div>
                   )}
                </div>
             </div>

             <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => handleToggleReorder(item)}
                  className={`py-1.5 rounded-lg text-xs font-medium border text-center
                  ${item.is_reordering ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-600'}`}
                >
                  {item.is_reordering ? 'Sedang Re-order' : 'Set Re-order'}
                </button>
                <button 
                  onClick={() => handleSetSupplierEmpty(item)}
                  className={`py-1.5 rounded-lg text-xs font-medium border text-center
                  ${item.status === StockStatus.SUPPLIER_EMPTY ? 'bg-gray-800 text-white border-gray-800' : 'bg-white border-gray-300 text-gray-600'}`}
                >
                  {item.status === StockStatus.SUPPLIER_EMPTY ? 'Supplier Kosong' : 'Set Supp. Kosong'}
                </button>
             </div>
          </div>
        ))}
      </div>

    </div>
  );
};

export default Dashboard;