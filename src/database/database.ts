import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

// Injection token for the SQLite connection.
export const DATABASE = 'DATABASE';

// Opens (or creates) the database and makes sure all tables exist.
// Use ':memory:' as filename for a throwaway database in tests.
export function openDatabase(filename: string): Database.Database {
  const db = new Database(filename);
  db.exec(SCHEMA_SQL);
  return db;
}
