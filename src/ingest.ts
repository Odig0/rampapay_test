import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IngestionService } from './ingestion/ingestion.service';

// Command-line entry point: `yarn ingest`.
// Uses an application context (Nest's dependency injection without an HTTP
// server), runs the ingestion once, prints a summary per file and exits.
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataDir = process.env.DATA_DIR ?? 'data';
    const summaries = app.get(IngestionService).ingestAll(dataDir);
    console.table(summaries);
  } finally {
    // Triggers onModuleDestroy, which closes the database connection.
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
