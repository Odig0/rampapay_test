import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ReportService } from './report.service';

@Module({
  imports: [DatabaseModule, LedgerModule],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
