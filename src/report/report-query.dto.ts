import { IsISO8601, IsOptional, Matches } from 'class-validator';

// Query string of GET /report.
export class ReportQueryDto {
  // Cut-off time, ISO 8601 with an explicit offset, e.g.
  // 2026-10-05T20:00:00-04:00. Same format the ingestion accepts (toUtc).
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/, {
    message:
      'asOf must be YYYY-MM-DDTHH:mm:ss with an offset, e.g. 2026-10-05T20:00:00-04:00',
  })
  asOf?: string;
}
