import { Knex } from 'knex';

export interface BrazilianPhoneCacheEntry {
  key: string;
  chatId: string;
  verified: boolean;
  resolvedAt: Date;
}

export interface BrazilianPhoneCacheRow extends BrazilianPhoneCacheEntry {
  id: number;
}

export interface BrazilianPhoneCacheStats {
  total: number;
  verified: number;
}

export class BrazilianPhoneCacheRepository {
  static tableName = 'app_brazilian_phone_numbers_cache';

  constructor(
    private readonly knex: Knex,
    private readonly appPk: number,
    private readonly ttlMs: number,
  ) {}

  get tableName() {
    return BrazilianPhoneCacheRepository.tableName;
  }

  // Entries resolved before this date are expired.
  private ttlCutoff(): Date {
    return new Date(Date.now() - this.ttlMs);
  }

  async get(key: string): Promise<BrazilianPhoneCacheEntry | null> {
    const row = await this.knex(this.tableName)
      .where({
        app_pk: this.appPk,
        key: key,
      })
      // Normalize the cutoff to ISO-8601 so the comparison matches the on-disk
      // representation produced by setMany (knex/sqlite3 otherwise coerces one
      // side to a number and the other to a string, silently breaking the >= check).
      .where('resolved_at', '>=', this.ttlCutoff().toISOString())
      .first();
    if (!row) {
      return null;
    }
    return {
      key: row.key,
      chatId: row.chat_id,
      verified: Boolean(row.verified),
      resolvedAt: new Date(row.resolved_at),
    };
  }

  async setMany(
    keys: string[],
    chatId: string,
    verified: boolean,
    resolvedAt: Date,
  ): Promise<void> {
    // Persist the timestamp as an ISO-8601 string so reads and TTL comparisons
    // compare like-for-like values against knex/sqlite3's `datetime` column.
    const resolvedAtIso = resolvedAt.toISOString();
    const rows = keys.map((key) => ({
      app_pk: this.appPk,
      key: key,
      chat_id: chatId,
      verified: verified,
      resolved_at: resolvedAtIso,
    }));
    await this.knex(this.tableName)
      .insert(rows)
      .onConflict(['app_pk', 'key'])
      .merge();
  }

  /**
   * Lists cache entries for the app, sorted by id (insertion order).
   */
  async list(limit: number, offset: number): Promise<BrazilianPhoneCacheRow[]> {
    const rows = await this.knex(this.tableName)
      .where({ app_pk: this.appPk })
      .orderBy('id', 'asc')
      .limit(limit)
      .offset(offset);
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      chatId: row.chat_id,
      verified: Boolean(row.verified),
      resolvedAt: new Date(row.resolved_at),
    }));
  }

  /**
   * Deletes cache entries for the app.
   * @param olderThan Only entries resolved before this date; all entries when omitted.
   * @returns Number of deleted entries
   */
  async purge(olderThan?: Date): Promise<number> {
    const query = this.knex(this.tableName).where({ app_pk: this.appPk });
    if (olderThan) {
      // Match the ISO-8601 representation stored by setMany so the comparison
      // does not silently mix string vs numeric coercion in sqlite3.
      query.where('resolved_at', '<', olderThan.toISOString());
    }
    return await query.delete();
  }

  async stats(): Promise<BrazilianPhoneCacheStats> {
    const row: any = await this.knex(this.tableName)
      .where({ app_pk: this.appPk })
      .count({ total: '*' })
      .first();
    const verifiedRow: any = await this.knex(this.tableName)
      .where({
        app_pk: this.appPk,
        verified: true,
      })
      .count({ verified: '*' })
      .first();
    return {
      total: Number(row?.total ?? 0),
      verified: Number(verifiedRow?.verified ?? 0),
    };
  }
}
