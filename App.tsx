import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import { loginToJubelio, fetchLiveStock } from './services/jubelioService';
import { getWatchedItems, saveWatchedItems, getLastFetchDate, setLastFetchDate } from './services/firebaseService';
import { WatchedItem } from './types';
import { CubeIcon } from '@heroicons/react/24/solid';

const App: React.FC = () => {
  const [view, setView] = useState<'LOGIN' | 'DASHBOARD'>('LOGIN');
  const [token, setToken] = useState<string>('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Data State
  const [items, setItems] = useState<WatchedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const authToken = await loginToJubelio(email, password);
      if (authToken) {
        setToken(authToken);
        await initDashboard(authToken);
      } else {
        setAuthError('Email atau password salah.');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Gagal login.');
    } finally {
      setAuthLoading(false);
    }
  };

  const initDashboard = async (activeToken: string) => {
    const savedItems = await getWatchedItems();
    setItems(savedItems);
    setView('DASHBOARD');

    // Requirement: Only fetch on first login of the day
    const lastFetch = getLastFetchDate();
    const today = new Date().toISOString().split('T')[0];

    if (savedItems.length > 0) {
      if (lastFetch !== today) {
        console.log("New day detected. Auto-fetching stocks...");
        runLiveUpdate(savedItems, activeToken);
      } else {
        console.log("Already fetched today. Using cached data.");
      }
    }
  };

  const runLiveUpdate = async (currentItems: WatchedItem[], activeToken: string = token) => {
    if (!activeToken) return;
    setRefreshing(true);
    try {
      const updated = await fetchLiveStock(activeToken, currentItems);
      setItems(updated);
      await saveWatchedItems(updated);
      setLastFetchDate(); // Mark today as fetched
    } catch (error: any) {
      console.error("Live sync failed", error);
      if (error.message === "UNAUTHORIZED") {
        setAuthError("Sesi berakhir. Silakan login kembali.");
        setView('LOGIN');
        setToken('');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogout = () => {
    setToken('');
    setView('LOGIN');
    setAuthError('');
  };

  if (view === 'LOGIN') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 space-y-6">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 bg-blue-600 rounded-full flex items-center justify-center text-white mb-4">
              <CubeIcon className="h-6 w-6" />
            </div>
            <h2 className="text-3xl font-extrabold text-gray-900">Top 200 SKU Watchlist</h2>
            <p className="mt-2 text-sm text-gray-600">Login ke Jubelio (API v2)</p>
          </div>
          
          <form className="mt-8 space-y-6" onSubmit={handleLogin}>
            <div className="rounded-md shadow-sm -space-y-px">
              <div><input type="email" required className="appearance-none rounded-t-md relative block w-full px-3 py-2 border border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div><input type="password" required className="appearance-none rounded-b-md relative block w-full px-3 py-2 border border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} /></div>
            </div>
            {authError && <div className="bg-red-50 p-3 rounded text-red-600 text-sm border border-red-100">{authError}</div>}
            <button type="submit" disabled={authLoading} className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm">{authLoading ? 'Memuat...' : 'Masuk'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <CubeIcon className="h-8 w-8 text-blue-600" />
              <h1 className="text-xl font-bold text-gray-900 hidden sm:block">Top 200 SKU Watchlist</h1>
            </div>
            <button onClick={handleLogout} className="text-gray-500 hover:text-red-600 text-sm font-medium transition-colors">Keluar</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Dashboard 
          items={items} 
          refreshData={(itemsOverride) => runLiveUpdate(itemsOverride || items)} 
          isRefreshing={refreshing} 
          token={token}
          onItemsUpdated={setItems}
        />
      </main>
    </div>
  );
};

export default App;