import { ExcelImportRow, WatchedItem, StockStatus } from '../types';

/**
 * RULES:
 * 1. Avg Sales Per Day = Total Sold / 90
 * 2. Adjusted Restock Time = MAX(10, Restock Time)
 * 3. Min Stock = MAX(2, CEILING(Avg Sales Per Day * Adjusted Restock Time))
 * 4. Target Stock = MAX(3, CEILING(Total Sold / 3)) -> (Approx 1 Month)
 */
export const calculateInventoryMetrics = (
  row: ExcelImportRow, 
  resolvedId: number
): WatchedItem => {
  const avgSalesPerDay = row.sold_90d / 90;
  
  // Rule 2
  const adjustedRestockTime = Math.max(10, row.restock_days);
  
  // Rule 3
  const calculatedMin = Math.ceil(avgSalesPerDay * adjustedRestockTime);
  const minStock = Math.max(2, calculatedMin);

  // Rule 4 (Total Sold / 3 is roughly 30 days of sales)
  const calculatedTarget = Math.ceil(row.sold_90d / 3);
  const targetStock = Math.max(3, calculatedTarget);

  return {
    sku: row.sku,
    item_id: resolvedId,
    name: row.variation ? `${row.name} - ${row.variation}` : row.name,
    total_sold_90d: row.sold_90d,
    restock_time: row.restock_days,
    waktu_restock: row.waktu_restock_desc,
    min_stock: minStock,
    target_stock: targetStock,
    actual_stock: 0, // Placeholder, updated by live fetch
    status: StockStatus.NORMAL,
    is_reordering: false
  };
};

export const determineStatus = (actual: number, min: number, target: number, currentStatus?: StockStatus): StockStatus => {
  // If it was manually tagged as Supplier Empty and stock is still 0 (or negative), keep it.
  if (currentStatus === StockStatus.SUPPLIER_EMPTY && actual <= 0) {
    return StockStatus.SUPPLIER_EMPTY;
  }

  if (actual <= 0) return StockStatus.OUT_OF_STOCK;
  if (actual < min) return StockStatus.LOW_STOCK;
  if (actual > target * 1.5) return StockStatus.OVERSTOCK; // Optional overstock rule
  return StockStatus.NORMAL;
};

export const getDaysToNextQuarter = (): { days: number, targetDate: string } => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11

  // Quarters start: Jan 1 (0), Apr 1 (3), Jul 1 (6), Oct 1 (9)
  let targetMonth = 0;
  let targetYear = year;

  if (month < 3) targetMonth = 3;      // Apr
  else if (month < 6) targetMonth = 6; // Jul
  else if (month < 9) targetMonth = 9; // Oct
  else {
    targetMonth = 0; // Jan next year
    targetYear = year + 1;
  }

  const targetDate = new Date(targetYear, targetMonth, 1);
  const diffTime = Math.abs(targetDate.getTime() - now.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
  
  // Format target date in ID
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  const formatted = targetDate.toLocaleDateString('id-ID', options);

  return { days: diffDays, targetDate: formatted };
};

export const getDaysOutOfStock = (dateStr?: string): number => {
  if (!dateStr) return 0;
  const start = new Date(dateStr);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
};