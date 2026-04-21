import React, { useState, useMemo } from 'react';
import { DbjPikItem, StockStatus } from '../types';
import { resolveSkuIds, fetchDbjPikStock } from '../services/jubelioService';
import { saveDbjPikItems } from '../services/firebaseService';
import { 
  CloudArrowUpIcon, 
  ArrowPathIcon, 
  FunnelIcon,
  PlayIcon,
  TrashIcon,
  PlusIcon,
  TruckIcon,
  NoSymbolIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline';
import * as XLSX from 'xlsx';

interface DbjPikDashboardProps {
  items: DbjPikItem[];
  refreshData: (itemsOverride?: DbjPikItem[]) => void;
  isRefreshing: boolean;
  token: string;
  onItemsUpdated: (items: DbjPikItem[]) => void;
}

const StatusTile = ({ label, count, active, onClick, colorClass }: any) => (
  <div 
    onClick={onClick}
    className={`p-4 rounded-xl border cursor-pointer transition-all ${active ? 'ring-2 ring-blue-500 shadow-md' : 'hover:shadow-md opacity-80'} ${colorClass}`}
  >
    <div className="text-sm font-medium mb-1">{label}</div>
    <div className="text-2xl font-bold">{count}</div>
  </div>
);

const DbjPikDashboard: React.FC<DbjPikDashboardProps> = ({ items, refreshData, isRefreshing, token, onItemsUpdated }) => {
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'REORDER' | 'AMAN' | 'MENIPIS' | 'HABIS' | 'SUPPLIER_EMPTY'>('ALL');
  
  // Importer State
  const [showImporter, setShowImporter] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<'IDLE' | 'PARSING' | 'RESOLVING' | 'SAVING' | 'DONE'>('IDLE');
  const [importProgress, setImportProgress] = useState(0);
  const [importLogs, setImportLogs] = useState<string[]>([]);

  // Add Manual State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newVariation, setNewVariation] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Filter Logic
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesText = item.sku.toLowerCase().includes(filterText.toLowerCase()) || 
                          item.name.toLowerCase().includes(filterText.toLowerCase());
      
      let matchesStatus = true;
      if (statusFilter === 'REORDER') {
        matchesStatus = !!item.is_reordering;
      } else if (statusFilter === 'AMAN') {
        matchesStatus = item.actual_stock > 1;
      } else if (statusFilter === 'MENIPIS') {
        matchesStatus = item.actual_stock === 1;
      } else if (statusFilter === 'HABIS') {
        matchesStatus = item.status === StockStatus.OUT_OF_STOCK || (item.actual_stock < 1 && item.status !== StockStatus.SUPPLIER_EMPTY);
      } else if (statusFilter === 'SUPPLIER_EMPTY') {
        matchesStatus = item.status === StockStatus.SUPPLIER_EMPTY;
      }
      
      return matchesText && matchesStatus;
    });
  }, [items, filterText, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const counts = {
      total: items.length,
      reorder: 0,
      aman: 0,
      menipis: 0,
      habis: 0,
      supplier_empty: 0
    };
    items.forEach(i => {
      if (i.is_reordering) counts.reorder++;
      if (i.actual_stock > 1) counts.aman++;
      if (i.actual_stock === 1) counts.menipis++;
      if (i.actual_stock < 1 && i.status !== StockStatus.SUPPLIER_EMPTY) counts.habis++;
      if (i.status === StockStatus.SUPPLIER_EMPTY) counts.supplier_empty++;
    });
    return counts;
  }, [items]);

  // --- ACTIONS ---
  const handleDelete = async (sku: string) => {
    if (!window.confirm(`Hapus SKU ${sku} dari daftar?`)) return;
    const updated = items.filter(i => i.sku !== sku);
    onItemsUpdated(updated);
    await saveDbjPikItems(updated);
  };

  const handleToggleReorder = async (item: DbjPikItem) => {
    const updated = items.map(i => i.item_id === item.item_id ? { ...i, is_reordering: !i.is_reordering } : i);
    onItemsUpdated(updated);
    await saveDbjPikItems(updated);
  };

  const handleSetSupplierEmpty = async (item: DbjPikItem) => {
    const newStatus = item.status === StockStatus.SUPPLIER_EMPTY ? StockStatus.OUT_OF_STOCK : StockStatus.SUPPLIER_EMPTY;
    const updated = items.map(i => i.item_id === item.item_id ? { ...i, status: newStatus } : i);
    onItemsUpdated(updated);
    await saveDbjPikItems(updated);
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSku || !newName) return;
    setIsAdding(true);

    try {
      const skuIdMap = await resolveSkuIds(token, [newSku]);
      const id = skuIdMap.get(newSku);
      
      if (!id) {
        alert("SKU tidak ditemukan di Jubelio.");
        setIsAdding(false);
        return;
      }

      const newItem: DbjPikItem = {
        sku: newSku,
        name: newName,
        variation: newVariation,
        item_id: id,
        actual_stock: 0,
        status: StockStatus.OUT_OF_STOCK,
        is_reordering: false
      };

      const existingIndex = items.findIndex(i => i.sku === newSku);
      let updatedItems = [...items];
      
      if (existingIndex >= 0) {
        updatedItems[existingIndex] = newItem;
      } else {
        updatedItems.push(newItem);
      }

      onItemsUpdated(updatedItems);
      await saveDbjPikItems(updatedItems);
      
      // Fetch stock for the new item immediately
      refreshData(updatedItems);

      setShowAddModal(false);
      setNewSku('');
      setNewName('');
      setNewVariation('');
    } catch (err) {
      alert("Terjadi kesalahan saat menambahkan SKU.");
    } finally {
      setIsAdding(false);
    }
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
        
        // Expected columns: SKU, Nama, Variasi
        const rows = rawData.slice(1).map(r => ({
          sku: String(r[0] || '').trim(),
          name: String(r[1] || 'Unknown'),
          variation: String(r[2] || '').trim()
        })).filter(r => r.sku.length > 0);

        if (rows.length === 0) throw new Error("Tidak ada baris valid ditemukan.");

        const normalizeSku = (s: string) => String(s).trim().toLowerCase();

        const uniqueRowsMap = new Map<string, typeof rows[0]>();
        rows.forEach(r => uniqueRowsMap.set(normalizeSku(r.sku), r));
        const uniqueRows = Array.from(uniqueRowsMap.values());

        const skusToResolve = uniqueRows
          .filter(row => !items.some(existing => normalizeSku(existing.sku) === normalizeSku(row.sku)))
          .map(r => r.sku);

        let skuIdMap = new Map<string, number>();
        if (skusToResolve.length > 0) {
          setImportLogs(prev => [...prev, `Ditemukan ${skusToResolve.length} SKU baru. Memulai resolusi ID...`]);
          setImportStatus('RESOLVING');
          skuIdMap = await resolveSkuIds(token, skusToResolve, (curr, total) => {
            setImportProgress(Math.round((curr / total) * 100));
          });
        }

        setImportLogs(prev => [...prev, "Sinkronisasi data..."]);
        
        const processedItemsMap = new Map<string, DbjPikItem>();
        items.forEach(item => processedItemsMap.set(normalizeSku(item.sku), item));
        
        let addedCount = 0;
        let updatedCount = 0;
        
        uniqueRows.forEach(row => {
          const normSku = normalizeSku(row.sku);
          const existingItem = processedItemsMap.get(normSku);
          
          if (existingItem) {
            processedItemsMap.set(normSku, {
              ...existingItem,
              name: row.name,
              variation: row.variation
            });
            updatedCount++;
          } else {
            const id = skuIdMap.get(row.sku);
            if (id) {
              processedItemsMap.set(normSku, {
                sku: row.sku,
                name: row.name,
                variation: row.variation,
                item_id: id,
                actual_stock: 0,
                status: StockStatus.OUT_OF_STOCK,
                is_reordering: false
              });
              addedCount++;
            }
          }
        });

        const finalItems = Array.from(processedItemsMap.values());

        setImportLogs(prev => [...prev, `Berhasil: ${addedCount} baru, ${updatedCount} diperbarui.`]);
        setImportStatus('SAVING');
        
        await saveDbjPikItems(finalItems);
        onItemsUpdated(finalItems);
        setImportStatus('DONE');

        setImportLogs(prev => [...prev, "Mengambil data stok terbaru..."]);
        refreshData(finalItems);
        
      } catch (e: any) {
        setImportLogs(prev => [...prev, `Error: ${e.message}`]);
        setImportStatus('IDLE');
      }
    };
    reader.readAsBinaryString(importFile);
  };

  const exportToExcel = () => {
    const exportData = filteredItems.map(item => ({
      SKU: item.sku,
      Name: item.name,
      Variation: item.variation || '',
      Stock_DBJ_PIK: item.actual_stock,
      Status: item.status,
      Reorder: item.is_reordering ? 'Yes' : 'No'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "DBJ PIK");
    
    XLSX.writeFile(workbook, `DBJ_PIK_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const getRowClass = (status: string) => {
    switch (status) {
      case 'Menipis': return 'bg-yellow-50 hover:bg-yellow-100';
      case 'Habis': return 'bg-red-50 hover:bg-red-100';
      case 'Supplier Kosong': return 'bg-gray-100 hover:bg-gray-200 text-gray-500';
      default: return 'hover:bg-gray-50';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monitor DBJ PIK</h1>
          <p className="text-sm text-gray-500 mt-1">Pantau stok khusus untuk lokasi DBJ PIK (Location ID: 5)</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <PlusIcon className="h-4 w-4" />
          Tambah SKU Manual
        </button>
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
          count={stats.reorder} 
          active={statusFilter === 'REORDER'} 
          onClick={() => setStatusFilter('REORDER')}
          colorClass="bg-blue-50 border-blue-200 text-blue-800"
        />
        <StatusTile 
          label="Aman (> 1)" 
          count={stats.aman} 
          active={statusFilter === 'AMAN'} 
          onClick={() => setStatusFilter('AMAN')}
          colorClass="bg-green-50 border-green-200 text-green-800"
        />
        <StatusTile 
          label="Menipis (= 1)" 
          count={stats.menipis} 
          active={statusFilter === 'MENIPIS'} 
          onClick={() => setStatusFilter('MENIPIS')}
          colorClass="bg-yellow-50 border-yellow-200 text-yellow-800"
        />
        <StatusTile 
          label="Stok Habis (< 1)" 
          count={stats.habis} 
          active={statusFilter === 'HABIS'} 
          onClick={() => setStatusFilter('HABIS')}
          colorClass="bg-red-50 border-red-200 text-red-800"
        />
        <StatusTile 
          label="Supplier Kosong" 
          count={stats.supplier_empty} 
          active={statusFilter === 'SUPPLIER_EMPTY'} 
          onClick={() => setStatusFilter('SUPPLIER_EMPTY')}
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
            Upload Excel (SKU, Nama, Variasi)
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
              onClick={exportToExcel}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
              title="Download Data"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
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
      <div className="overflow-x-auto rounded-xl shadow-sm border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nama Produk</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Variasi</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stok DBJ PIK</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  Tidak ada data yang sesuai.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={`${item.sku}-${item.item_id}`} className={`${getRowClass(item.status)} transition-colors`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.sku}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={item.name}>
                    {item.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {item.variation || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${
                      item.actual_stock > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {item.actual_stock}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
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
                        disabled={item.actual_stock > 0}
                        className={`p-1 rounded-md transition-colors ${item.status === StockStatus.SUPPLIER_EMPTY ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-800 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                      >
                        <NoSymbolIcon className="h-5 w-5" />
                      </button>
                      <button 
                        onClick={() => handleDelete(item.sku)}
                        className="text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition-colors"
                        title="Hapus SKU"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ADD MANUAL MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Tambah SKU Manual</h2>
            <form onSubmit={handleAddManual} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SKU Code *</label>
                <input 
                  type="text" 
                  required
                  value={newSku}
                  onChange={e => setNewSku(e.target.value)}
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 p-2 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Produk *</label>
                <input 
                  type="text" 
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 p-2 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Variasi (Opsional)</label>
                <input 
                  type="text" 
                  value={newVariation}
                  onChange={e => setNewVariation(e.target.value)}
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 p-2 border"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"
                >
                  Batal
                </button>
                <button 
                  type="submit"
                  disabled={isAdding}
                  className="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium flex items-center gap-2 disabled:opacity-70"
                >
                  {isAdding && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DbjPikDashboard;
