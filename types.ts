export enum StockStatus {
  NORMAL = 'Aman',
  LOW_STOCK = 'Menipis',
  OUT_OF_STOCK = 'Habis',
  OVERSTOCK = 'Overstock',
  SUPPLIER_EMPTY = 'Supplier Kosong'
}

export interface WatchedItem {
  sku: string;
  item_id: number; // Resolved from API
  name: string;
  
  // Excel Inputs
  total_sold_90d: number;
  restock_time: number;
  waktu_restock?: string; // Static description from Excel
  
  // Calculated Ruleset
  min_stock: number;
  target_stock: number;
  
  // Live Data
  actual_stock: number;
  status: StockStatus;
  out_of_stock_since?: string; // ISO Date string
  
  // Manual Flags
  is_reordering?: boolean; // Tag 'Sedang Re-order'
}

export interface DbjPikItem {
  sku: string;
  name: string;
  variation?: string;
  item_id: number;
  actual_stock: number;
  status: StockStatus;
  is_reordering?: boolean;
}

export interface ExcelImportRow {
  sku: string;
  name: string;
  variation: string;
  sold_90d: number;
  restock_days: number;
  waktu_restock_desc?: string;
}