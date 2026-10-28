const API_BASE = 'https://api.statistiken.bundesbank.de/rest/data/BBIG1/D.D0.EUR.MMKT.EURIBOR.M12.BID._Z';
const DEFAULT_START_PERIOD = '2019-01-01';
const BATCH_SIZE = 450;

function parseObservations(payload, { allowEmpty = false } = {}) {
  const observationDimension = payload?.data?.structure?.dimensions?.observation
    ?.find((dimension) => dimension.id === 'TIME_PERIOD');
  const series = payload?.data?.dataSets?.[0]?.series;
  if (!observationDimension || !series || typeof series !== 'object') {
    throw new Error('La respuesta no tiene la estructura SDMX esperada (series/TIME_PERIOD).');
  }

  const records = [];
  for (const item of Object.values(series)) {
    for (const [index, observation] of Object.entries(item.observations || {})) {
      const date = observationDimension.values[Number(index)]?.id;
      const rawValue = Array.isArray(observation) ? observation[0] : observation;
      if (rawValue === null || rawValue === undefined || rawValue === '') continue;
      const value = Number(rawValue);
      if (!date || !Number.isFinite(value)) {
        throw new Error(`Observación inválida para el periodo ${date || index}.`);
      }
      records.push({ date, value });
    }
  }

  if (records.length === 0 && !allowEmpty) {
    throw new Error('La respuesta del Bundesbank no contiene observaciones.');
  }

  return records.sort((first, second) => first.date.localeCompare(second.date));
}

// Inicio del periodo: los últimos N días si EURIBOR_LOOKBACK_DAYS está definido; si no,
// EURIBOR_START_PERIOD o el histórico completo.
function resolveStartPeriod(env, now = new Date()) {
  const rawLookback = env.EURIBOR_LOOKBACK_DAYS;
  if (rawLookback !== undefined && rawLookback !== '') {
    const days = Number(rawLookback);
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error('EURIBOR_LOOKBACK_DAYS debe ser un número entero de días mayor que cero.');
    }
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return env.EURIBOR_START_PERIOD || DEFAULT_START_PERIOD;
}

function readServiceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return null;
  try {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no contiene un JSON válido.');
  }
}

async function syncEuribor() {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
  const { applicationDefault, cert, initializeApp } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const serviceAccount = readServiceAccount(process.env);
  const projectId = process.env.FIREBASE_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || (serviceAccount && serviceAccount.project_id);
  if (!serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !projectId) {
    throw new Error('Configura FIREBASE_SERVICE_ACCOUNT, o GOOGLE_APPLICATION_CREDENTIALS y/o FIREBASE_PROJECT_ID.');
  }

  const endPeriod = new Date().toISOString().slice(0, 10);
  const startPeriod = resolveStartPeriod(process.env);
  const isPartial = Boolean(process.env.EURIBOR_LOOKBACK_DAYS);
  const url = new URL(API_BASE);
  url.searchParams.set('startPeriod', startPeriod);
  url.searchParams.set('endPeriod', endPeriod);
  url.searchParams.set('format', 'sdmx_json');

  const response = await fetch(url);
  if (response.status === 404 && isPartial) {
    console.log(`Sin datos nuevos del Euríbor entre ${startPeriod} y ${endPeriod}.`);
    return;
  }
  if (!response.ok) {
    throw new Error(`Bundesbank respondió con HTTP ${response.status}.`);
  }

  const records = parseObservations(await response.json(), { allowEmpty: isPartial });
  if (records.length === 0) {
    console.log(`Sin datos nuevos del Euríbor entre ${startPeriod} y ${endPeriod}.`);
    return;
  }
  initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });

  const firestore = getFirestore();
  for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
    const batch = firestore.batch();
    for (const record of records.slice(offset, offset + BATCH_SIZE)) {
      batch.set(firestore.collection('euribor_history').doc(record.date), {
        ...record,
        source: 'Deutsche Bundesbank',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
  }

  console.log(`Sincronizados ${records.length} datos del Euríbor (${startPeriod} a ${endPeriod}).`);
}

if (require.main === module) {
  syncEuribor().catch((error) => {
    console.error(`Error al sincronizar el Euríbor: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseObservations, resolveStartPeriod };
