import { Module } from '@nestjs/common';
import { IngestionModule } from './ingestion/ingestion.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [IngestionModule, LedgerModule],
})
export class AppModule {}
