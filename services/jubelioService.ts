import { WatchedItem, StockStatus, DbjPikItem } from '../types';
import { determineStatus } from '../utils/calculations';

// Set to false to use Real API
const USE_MOCK_DATA = false;

let activeBaseUrl = 'https://api2.jubelio.com'; 

const handleApiResponse = async (res: Response) => {
  if (!res.ok) {
    // Specifically throw 401 so App.tsx can handle it
    if (res.status === 401) {
      throw new Error("UNAUTHORIZED");
    }
    const text = await res.text();
    throw new Error(`API Error ${res.status}: ${text.substring(0, 100)}`);
  }
  return res.json();
};

// --- Helper: Rate-Limited Batch Processor ---
async function processInBatches<T, R>(
  items: T[], 
  batchSize: number, 
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => fn(item).catch(e => {
        console.warn(`Batch item failed:`, e);
        return null; 
      }))
    );
    results.push(...(batchResults.filter(r => r !== null) as R[]));
    
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return results;
}

export const loginToJubelio = async (email: string, pass: string): Promise<string | null> => {
  if (USE_MOCK_DATA) return 'mock-token';

  const loginBody = JSON.stringify({ email, password: pass });
  const headers = { 
    'Content-Type': 'application/json'
  };

  // Try both api2 and api endpoints as fallback
  const endpoints = [
    'https://api2.jubelio.com/login',
    'https://api.jubelio.com/login'
  ];

  let lastError: any = null;

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { 
        method: 'POST', 
        headers, 
        body: loginBody,
        // Ensure we don't send credentials/cookies that might interfere
        credentials: 'omit' 
      });

      if (res.status === 401) {
        return null; // Explicitly wrong credentials
      }

      if (!res.ok) {
        const text = await res.text();
        console.warn(`Login attempt to ${url} failed:`, res.status, text);
        lastError = new Error(`API Error ${res.status}: ${text.substring(0, 200)}`);
        continue; // Try next endpoint
      }

      const data = await res.json();
      const token = data.token || data.data?.token;
      
      if (token) {
        // Update the base URL to the one that worked
        activeBaseUrl = url.replace('/login', '');
        console.log(`Successfully logged in via ${activeBaseUrl}`);
        return token;
      }
    } catch (err: any) {
      console.error(`Network error for ${url}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("Gagal login. Silakan periksa koneksi atau kredensial Anda.");
};

// --- STEP 1: RESOLVE SKU TO ID (During Upload) ---
const resolveSingleSku = async (token: string, sku: string): Promise<{sku: string, item_id: number} | null> => {
  if (USE_MOCK_DATA) return { sku, item_id: Math.floor(Math.random() * 10000) + 1 };

  try {
    const encodedSku = encodeURIComponent(sku);
    // Restored Bearer prefix
    const res = await fetch(`${activeBaseUrl}/inventory/items/by-sku/${encodedSku}`, {
      headers: { 
        'Authorization': `Bearer ${token}`, 
        'Accept': 'application/json' 
      }
    });

    if (!res.ok) return null;

    const rawRes = await res.json();
    const data = rawRes.data || rawRes;
    let itemId: number | undefined;

    if (Array.isArray(data.product_skus)) {
        const skuEntry = data.product_skus.find((ps: any) => 
            String(ps.item_code).toLowerCase() === sku.toLowerCase()
        );
        if (skuEntry) itemId = Number(skuEntry.item_id);
        else if (data.product_skus.length > 0) itemId = Number(data.product_skus[0].item_id);
    }

    if ((itemId === undefined || isNaN(itemId)) && data.item_id) {
        itemId = Number(data.item_id);
    }

    if (itemId && !isNaN(itemId)) {
      return { sku, item_id: itemId };
    }
    return null;
  } catch (e) {
    return null;
  }
};

export const resolveSkuIds = async (token: string, skus: string[], onProgress?: (current: number, total: number) => void): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  let processed = 0;

  await processInBatches(skus, 5, async (sku) => {
    const result = await resolveSingleSku(token, sku);
    if (result) {
      map.set(result.sku, result.item_id);
    }
    processed++;
    if (onProgress) onProgress(processed, skus.length);
    return result;
  });

  return map;
};

// --- STEP 2: FETCH LIVE STOCK (During Dashboard View) ---
export const fetchLiveStock = async (token: string, items: WatchedItem[]): Promise<WatchedItem[]> => {
  const itemIds = items.map(i => i.item_id).filter(id => id > 0);
  const stockMap = new Map<number, number>();

  if (itemIds.length === 0) return items;

  if (USE_MOCK_DATA) {
    items.forEach(i => stockMap.set(i.item_id, Math.floor(Math.random() * 50)));
  } else {
    const chunkedIds = [];
    for (let i = 0; i < itemIds.length; i += 50) {
      chunkedIds.push(itemIds.slice(i, i + 50));
    }

    for (const chunk of chunkedIds) {
      // Restored trailing slash and Bearer prefix
      const res = await fetch(`${activeBaseUrl}/inventory/items/all-stocks/`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ ids: chunk })
      });
      
      const json = await handleApiResponse(res);
      const list = Array.isArray(json) ? json : (json.data || []);

      list.forEach((s: any) => {
        let qty = 0;
        if (s.total_stocks && s.total_stocks.available !== undefined) {
          qty = Number(s.total_stocks.available);
        } else if (s.available !== undefined) {
          qty = Number(s.available);
        }
        if (!isNaN(qty)) stockMap.set(Number(s.item_id), qty);
      });
    }
  }

  return items.map(item => {
    const actual = stockMap.has(item.item_id) ? stockMap.get(item.item_id)! : 0;
    
    // Out of Stock Counter Logic
    let outOfStockSince = item.out_of_stock_since;
    if (actual <= 0) {
      if (!outOfStockSince) {
        outOfStockSince = new Date().toISOString();
      }
    } else {
      outOfStockSince = undefined;
    }

    // Auto-remove reorder tag if stock increases
    let isReordering = item.is_reordering;
    if (isReordering && actual > item.actual_stock) {
      isReordering = false;
    }

    // Pass current status to preserve manual tags like 'Supplier Empty' if still 0
    return {
      ...item,
      actual_stock: actual,
      is_reordering: isReordering,
      status: determineStatus(actual, item.min_stock, item.target_stock, item.status),
      out_of_stock_since: outOfStockSince
    };
  });
};

// --- DBJ PIK STOCK FETCH ---
export const fetchDbjPikStock = async (token: string, items: DbjPikItem[]): Promise<DbjPikItem[]> => {
  const itemIds = items.map(i => i.item_id).filter(id => id > 0);
  const stockMap = new Map<number, number>();

  if (itemIds.length === 0) return items;

  if (USE_MOCK_DATA) {
    items.forEach(i => stockMap.set(i.item_id, Math.floor(Math.random() * 50)));
  } else {
    const chunkedIds = [];
    for (let i = 0; i < itemIds.length; i += 50) {
      chunkedIds.push(itemIds.slice(i, i + 50));
    }

    for (const chunk of chunkedIds) {
      const res = await fetch(`${activeBaseUrl}/inventory/items/all-stocks/`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ ids: chunk })
      });
      
      const json = await handleApiResponse(res);
      const list = Array.isArray(json) ? json : (json.data || []);

      list.forEach((s: any) => {
        let qty = 0;
        if (s.location_stocks && Array.isArray(s.location_stocks)) {
          const loc = s.location_stocks.find((l: any) => l.location_id === 5);
          if (loc && loc.available !== undefined) {
            qty = Number(loc.available);
          }
        }
        if (!isNaN(qty)) stockMap.set(Number(s.item_id), qty);
      });
    }
  }

  return items.map(item => ({
    ...item,
    actual_stock: stockMap.has(item.item_id) ? stockMap.get(item.item_id)! : 0
  }));
};