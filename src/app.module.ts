import { Module } from '@nestjs/common';
import { IngestionModule } from './ingestion/ingestion.module';
import { LedgerModule } from './ledger/ledger.module';
import { ReportModule } from './report/report.module';

@Module({
  imports: [IngestionModule, LedgerModule, ReportModule],
})
export class AppModule {}
