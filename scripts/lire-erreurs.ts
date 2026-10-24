import { getDb } from '../api/queries/connection';
import * as s from '../db/schema';
import { desc } from 'drizzle-orm';

const db = getDb();
(async () => {
  const errs = await db.select().from(s.erreursClient).orderBy(desc(s.erreursClient.creeLe)).limit(3);
  for (const e of errs) {
    console.log('---');
    console.log('Code:', e.codeCourt);
    console.log('Route:', e.route);
    console.log('Message:', e.message);
    console.log('Stack:', (e.stack ?? '').slice(0, 800));
    console.log('Date:', e.creeLe);
  }
  process.exit(0);
})();
