import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { IngestionService } from './ingestion/ingestion.service';
import { formatMinorUnits } from './ingestion/money';
import { toUtc } from './ingestion/timestamps';
import { CURRENCY_DECIMALS } from './ledger/accounts';
import { LedgerService } from './ledger/ledger.service';
import { boliviaTime } from './report/format';
import { DEFAULT_REPORT_AS_OF } from './report/report-as-of';
import { ReconciliationReport, ReportService } from './report/report.service';

const REPORT_FILE = 'reconciliation-report.json';

// Command-line entry point: `yarn reconcile`.
// Uses an application context (Nest's dependency injection without an HTTP
// server): ingests the files, posts the ledger, prints balances and breaks,
// writes the full report to output/ and exits.
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataDir = process.env.DATA_DIR ?? 'data';
    const outputDir = process.env.OUTPUT_DIR ?? 'output';
    const asOf = toUtc(DEFAULT_REPORT_AS_OF);

    console.log('Ingestion');
    console.table(app.get(IngestionService).ingestAll(dataDir));

    const ledger = app.get(LedgerService);
    const posting = ledger.postAll();
    console.log(
      `\nLedger: ${posting.posted} entries posted, ${posting.skipped} already posted`,
    );
    console.log(`\nLedger accounts as of ${DEFAULT_REPORT_AS_OF}`);
    for (const b of ledger.getBalances(asOf)) {
      const value = formatMinorUnits(
        b.balance_minor,
        CURRENCY_DECIMALS[b.currency],
        2,
      );
      console.log(
        `  ${b.account.padEnd(25)} ${value.padStart(12)} ${b.currency}`,
      );
    }

    const report = app.get(ReportService).buildReport(asOf);
    printReport(report);

    mkdirSync(outputDir, { recursive: true });
    const reportPath = join(outputDir, REPORT_FILE);
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nFull report written to ${reportPath}`);
  } finally {
    // Triggers onModuleDestroy, which closes the database connection.
    await app.close();
  }
}

function printReport(report: ReconciliationReport) {
  const { balances } = report;
  console.log(`\nBalances as of ${report.asOf}`);
  const rows: [string, { amount: string; currency: string }][] = [
    ['USDT sent, not yet converted', balances.usdtNotConverted],
    ['Bs available at the provider', balances.bsAvailableAtProvider],
    ['Bs paid out', balances.bsPaidOut],
    ['Bs in pay-outs not yet final', balances.bsInPendingPayouts],
  ];
  for (const [label, value] of rows) {
    console.log(
      `  ${label.padEnd(30)} ${value.amount.padStart(12)} ${value.currency}`,
    );
  }

  console.log('\nPay-outs by status');
  for (const [status, { count, amount }] of Object.entries(report.payouts)) {
    console.log(
      `  ${status.padEnd(10)} ${String(count).padStart(3)}  ${amount.amount.padStart(12)} ${amount.currency}`,
    );
  }

  console.log(
    `\nBreaks: ${report.breaks.length} (${report.breakCount.HIGH} high, ${report.breakCount.MEDIUM} medium)`,
  );
  for (const b of report.breaks) {
    const time = b.at === null ? '--:--' : boliviaTime(b.at);
    console.log(`  [${b.severity}] ${time} ${b.code} ${b.ref}`);
    console.log(`      ${b.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
