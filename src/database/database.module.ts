import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DATABASE, openDatabase } from './database';

@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: () => openDatabase(process.env.DB_PATH ?? 'rampa.db'),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly db: Database.Database) {}

  onModuleDestroy() {
    this.db.close();
  }
}
