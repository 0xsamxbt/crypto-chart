import { MongoClient } from 'mongodb';

let client = null;
let db = null;

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (copy .env.example to .env)');

  client = new MongoClient(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'crypto_chart');

  // one document per candle; the unique index also makes range queries fast
  await db.collection('candles').createIndex({ symbol: 1, interval: 1, t: 1 }, { unique: true });
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database is not connected');
  return db;
}

// dependency injection hook (used by tests)
export function setDb(database) {
  db = database;
}

export async function closeDb() {
  await client?.close();
  client = null;
  db = null;
}
