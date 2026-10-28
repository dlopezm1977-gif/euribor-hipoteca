import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function useEuribor() {
  const [rates, setRates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadRates() {
      try {
        const result = await getDocs(query(
          collection(db, 'euribor_history'),
          orderBy('date', 'asc')
        ));
        if (!active) return;
        setRates(result.docs.map((snapshot) => snapshot.data()));
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message || 'No se pudo cargar el histórico del Euríbor.');
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadRates();
    return () => {
      active = false;
    };
  }, []);

  return { rates, isLoading, error };
}
