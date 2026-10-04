import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { toUtc } from '../common/timestamps';
import { DEFAULT_REPORT_AS_OF } from './report-as-of';
import { ReportQueryDto } from './report-query.dto';
import type { ReconciliationReport } from './report.service';
import { ReportService } from './report.service';

// Read-only access to the report. It reads what is already in the database:
// run `yarn reconcile` first to ingest the files and post the ledger.
@Controller('report')
export class ReportController {
  constructor(private readonly report: ReportService) {}

  // GET /report?asOf=2026-10-05T20:00:00-04:00 (asOf is optional).
  // An invalid asOf is answered with 400 by the ValidationPipe.
  @Get()
  getReport(
    @Query(new ValidationPipe()) query: ReportQueryDto,
  ): ReconciliationReport {
    return this.report.buildReport(toUtc(query.asOf ?? DEFAULT_REPORT_AS_OF));
  }
}
