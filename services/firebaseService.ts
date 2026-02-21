import { WatchedItem } from '../types';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

// Firebase Configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Attempt to sign in anonymously to satisfy "request.auth != null" rules if present
signInAnonymously(auth).catch((error) => {
  console.warn("Anonymous auth failed (this is expected if Auth is not enabled in console):", error);
});

// Collection: 'watchlist', Document: 'main'
const COLLECTION_NAME = 'watchlist';
const DOC_ID = 'main';

const META_KEY = 'vip_watchlist_meta';

export const saveWatchedItems = async (items: WatchedItem[]) => {
  try {
    // Sanitize items: Firestore doesn't support 'undefined' values.
    // JSON.stringify/parse is a quick way to strip undefined fields.
    const cleanItems = JSON.parse(JSON.stringify(items));

    // Save to Firestore
    const docRef = doc(db, COLLECTION_NAME, DOC_ID);
    await setDoc(docRef, { items: cleanItems }, { merge: true });
  } catch (e) {
    console.error("Failed to save to Firestore", e);
  }
};

export const getWatchedItems = async (): Promise<WatchedItem[]> => {
  try {
    const docRef = doc(db, COLLECTION_NAME, DOC_ID);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return (data.items as WatchedItem[]) || [];
    } else {
      console.log("No such document!");
      return [];
    }
  } catch (e) {
    console.error("Failed to read from Firestore", e);
    return [];
  }
};

// Keep metadata (last fetch date) in LocalStorage for now as it's per-device/session optimization
export const setLastFetchDate = () => {
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem(META_KEY, JSON.stringify({ lastFetch: today }));
};

export const getLastFetchDate = (): string | null => {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    return JSON.parse(raw).lastFetch;
  } catch {
    return null;
  }
};