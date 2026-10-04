import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { formatMinorUnits } from './ingestion/money';
import { IngestionService } from './ingestion/ingestion.service';
import { toUtc } from './ingestion/timestamps';
import { CURRENCY_DECIMALS } from './ledger/accounts';
import { AccountBalance, LedgerService } from './ledger/ledger.service';

// Report time from the brief: 20:00 Bolivia time (UTC-4).
const REPORT_AS_OF = '2026-10-05T20:00:00-04:00';

// Command-line entry point: `yarn ingest`.
// Uses an application context (Nest's dependency injection without an HTTP
// server): ingests the files, posts the ledger, prints balances and exits.
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataDir = process.env.DATA_DIR ?? 'data';
    console.log('Ingestion');
    console.table(app.get(IngestionService).ingestAll(dataDir));

    const ledger = app.get(LedgerService);
    const posting = ledger.postAll();
    console.log(
      `\nLedger: ${posting.posted} entries posted, ${posting.skipped} already posted`,
    );

    const asOfUtc = toUtc(REPORT_AS_OF);
    console.log(`\nBalances as of ${REPORT_AS_OF} (${asOfUtc})`);
    printBalances(ledger.getBalances(asOfUtc));
  } finally {
    // Triggers onModuleDestroy, which closes the database connection.
    await app.close();
  }
}

function printBalances(balances: AccountBalance[]) {
  for (const { account, currency, balance_minor } of balances) {
    const amount = formatMinorUnits(
      balance_minor,
      CURRENCY_DECIMALS[currency],
      2,
    );
    console.log(`  ${account.padEnd(25)} ${amount.padStart(12)} ${currency}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
