import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [DatabaseModule],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
