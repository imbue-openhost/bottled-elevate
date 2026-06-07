import { Inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { timeout } from "rxjs/operators";
import _ from "lodash";
import { SyncService } from "../sync.service";
import { SyncState } from "../sync-state.enum";
import { SyncDateTimeDao } from "../../../dao/sync/sync-date-time.dao";
import { VersionsProvider } from "../../versions/versions-provider";
import { ActivityService } from "../../activity/activity.service";
import { AthleteService } from "../../athlete/athlete.service";
import { UserSettingsService } from "../../user-settings/user-settings.service";
import { StreamsService } from "../../streams/streams.service";
import { LoggerService } from "../../logging/logger.service";
import { DataStore } from "../../../data-store/data-store";
import { SyncDateTime } from "@elevate/shared/models/sync/sync-date-time.model";
import { Streams } from "@elevate/shared/models/activity-data/streams.model";
import { DeflatedActivityStreams } from "@elevate/shared/models/sync/deflated-activity.streams";
import { environment } from "../../../../../environments/environment";
import { Activity } from "@elevate/shared/models/sync/activity.model";
import { buildActivityFromWorkout, ProviderWorkout } from "./web-activity-mapper";

interface BuiltWorkout {
  activity: Activity;
  streams: Streams | null;
}

/**
 * Web sync service for OpenHost. Pulls workouts from the health-data service (via the
 * same-origin proxy) and stores them in the local IndexedDB store.
 *
 * Crash-safe by design: workouts are imported newest-first and persisted per batch, and
 * workouts already in the store are skipped. So an interrupted sync keeps the most recent
 * activities and the next run cheaply resumes the unimported tail instead of refetching
 * everything. `syncDateTime` is written only once a full pass completes; until then the
 * state is PARTIALLY_SYNCED and the next sync continues the backfill.
 *
 * A full sync fetches everything; a fast sync (auto-sync on load) only lists a recent
 * window once an initial sync exists.
 */
@Injectable()
export class WebSyncService extends SyncService<SyncDateTime> {
  public isSyncing: boolean;
  private aborted: boolean;

  constructor(
    @Inject(VersionsProvider) public readonly versionsProvider: VersionsProvider,
    @Inject(DataStore) public readonly dataStore: DataStore<object>,
    @Inject(ActivityService) public readonly activityService: ActivityService,
    @Inject(StreamsService) public readonly streamsService: StreamsService,
    @Inject(AthleteService) public readonly athleteService: AthleteService,
    @Inject(UserSettingsService) public readonly userSettingsService: UserSettingsService,
    @Inject(LoggerService) public readonly logger: LoggerService,
    @Inject(SyncDateTimeDao) public readonly syncDateTimeDao: SyncDateTimeDao,
    @Inject(HttpClient) public readonly httpClient: HttpClient
  ) {
    super(versionsProvider, dataStore, activityService, streamsService, athleteService, userSettingsService, logger);

    this.isSyncing = false;
    this.aborted = false;
    this.isSyncing$.subscribe(isSyncing => {
      this.isSyncing = isSyncing;
    });
  }

  public static readonly WORKOUTS_ENDPOINT: string = "/api/workouts";
  public static readonly WORKOUTS_LIMIT: number = 5000;
  // Fast sync re-fetches this trailing window (covers timezone skew + recently edited workouts).
  public static readonly FAST_SYNC_WINDOW_MS: number = 7 * 24 * 3600 * 1000;
  // Concurrent per-workout detail fetches (the list endpoint is summary-only).
  public static readonly DETAIL_CONCURRENCY: number = 8;
  // Per-request timeout so one stalled detail fetch can't hang the whole sync.
  public static readonly REQUEST_TIMEOUT_MS: number = 30000;

  public async sync(fastSync: boolean, forceSync: boolean): Promise<void> {
    if (this.isSyncing) {
      return;
    }
    this.aborted = false;
    this.isSyncing$.next(true);
    this.syncProgress$.next(null);
    try {
      if (forceSync) {
        await this.clearActivities();
      }

      const since = await this.resolveIncrementalStart(fastSync, forceSync);
      let url = `${environment.backendBaseUrl}${WebSyncService.WORKOUTS_ENDPOINT}?limit=${WebSyncService.WORKOUTS_LIMIT}`;
      if (since) {
        url += `&start=${encodeURIComponent(since)}`;
      }
      const response = await this.get<{ data: ProviderWorkout[] }>(url);
      // The service lists workouts ascending (oldest first); import newest-first so the
      // most recent activities land first and survive an interrupted sync.
      const summaries = (response?.data || []).filter(w => w?.id && w?.start && w?.end).reverse();

      // Skip workouts already imported: makes a resumed sync cheap (no detail refetch).
      const existingIds = await this.existingActivityIds();
      const toImport = summaries.filter(s => !existingIds.has(this.activityId(s)));
      this.logger.info(
        `Listed ${summaries.length} workout(s)${since ? ` since ${since}` : ""}; ${toImport.length} new to import`
      );

      const userSettings = await this.userSettingsService.fetch();
      // Refresh athlete snapshot resolver so each activity is stamped with the right settings.
      await this.activityService.athleteSnapshotResolver.update();

      const total = toImport.length;
      this.syncProgress$.next({ imported: 0, total });

      // Fetch each new workout's full detail (HR trace + route) in concurrent batches,
      // then persist the batch in one store write (instead of a save per record).
      let imported = 0;
      for (let i = 0; i < toImport.length && !this.aborted; i += WebSyncService.DETAIL_CONCURRENCY) {
        const batch = toImport.slice(i, i + WebSyncService.DETAIL_CONCURRENCY);
        const results = await Promise.all(batch.map(summary => this.buildWorkout(summary, userSettings)));
        const built = results.filter((b): b is BuiltWorkout => b !== null);
        if (built.length) {
          await this.activityService.insertMany(
            built.map(b => b.activity),
            true
          );
          const streamModels = built
            .filter(b => b.streams)
            .map(b => new DeflatedActivityStreams(String(b.activity.id), Streams.deflate(b.streams as Streams)));
          if (streamModels.length) {
            await this.streamsService.insertMany(streamModels);
          }
        }
        imported += built.length;
        this.syncProgress$.next({ imported, total });
        this.logger.debug(`Synced ${imported}/${total}`);
      }

      if (this.aborted) {
        this.logger.info(`Sync stopped: ${imported}/${total} imported (will resume next sync)`);
      } else {
        // Mark a completed pass so subsequent loads do a cheap incremental fast-sync.
        await this.updateSyncDateTime(new SyncDateTime(Date.now()));
        await this.dataStore.persist(true);
        this.logger.info(`Sync done: ${imported} activity(ies) imported`);
      }
    } catch (error) {
      this.logger.error("WebSyncService.sync() failed", error);
      throw error;
    } finally {
      this.syncProgress$.next(null);
      this.isSyncing$.next(false);
    }
  }

  /** Fetch one workout's full detail and build its activity + streams (no persistence). */
  private async buildWorkout(summary: ProviderWorkout, userSettings: any): Promise<BuiltWorkout | null> {
    if (this.aborted) {
      return null;
    }
    let full: ProviderWorkout = summary;
    try {
      const detail = await this.get<ProviderWorkout>(
        `${environment.backendBaseUrl}${WebSyncService.WORKOUTS_ENDPOINT}/${encodeURIComponent(summary.id)}`
      );
      if (detail) {
        full = detail;
      }
    } catch (error) {
      this.logger.warn(`Detail fetch failed for ${summary.id}; using summary`, error);
    }

    try {
      const snapshot = this.activityService.athleteSnapshotResolver.resolve(new Date(full.start));
      return await buildActivityFromWorkout(full, snapshot, userSettings);
    } catch (error) {
      this.logger.warn(`Failed to build workout ${summary.id}`, error);
      return null;
    }
  }

  /** GET with a per-request timeout so a stalled response can't hang the sync. */
  private get<T>(url: string): Promise<T> {
    return this.httpClient.get<T>(url).pipe(timeout(WebSyncService.REQUEST_TIMEOUT_MS)).toPromise();
  }

  /** Activity id a summary will map to (must match web-activity-mapper's id scheme). */
  private activityId(summary: ProviderWorkout): string {
    return `${summary.source || "openhost"}:${summary.id}`;
  }

  private async existingActivityIds(): Promise<Set<string>> {
    const activities = await this.activityService.find();
    return new Set(activities.map(a => String(a.id)));
  }

  /** For a fast sync with existing data, return the ISO start of the trailing window; else null (full sync). */
  private async resolveIncrementalStart(fastSync: boolean, forceSync: boolean): Promise<string | null> {
    if (!fastSync || forceSync) {
      return null;
    }
    const [last, count] = await Promise.all([this.getSyncDateTime(), this.activityService.count()]);
    if (!last || !_.isNumber(last.syncDateTime) || count === 0) {
      return null;
    }
    return new Date(last.syncDateTime - WebSyncService.FAST_SYNC_WINDOW_MS).toISOString();
  }

  public getSyncState(): Promise<SyncState> {
    return Promise.all([this.getSyncDateTime(), this.activityService.count()]).then(
      ([syncDateTime, activitiesCount]) => {
        const hasSyncDateTime: boolean = syncDateTime && _.isNumber(syncDateTime.syncDateTime);
        const hasActivities: boolean = activitiesCount > 0;

        if (!hasSyncDateTime && !hasActivities) {
          return SyncState.NOT_SYNCED;
        } else if (!hasSyncDateTime && hasActivities) {
          return SyncState.PARTIALLY_SYNCED;
        }
        return SyncState.SYNCED;
      }
    );
  }

  // Cancel an in-flight sync. The import loop checks `aborted` between batches and bails out
  // without writing syncDateTime, so the next sync resumes the remaining workouts.
  public stop(): Promise<void> {
    if (this.isSyncing) {
      this.aborted = true;
    }
    return Promise.resolve();
  }

  public backup(): any {
    return Promise.reject("Backup is not supported on the web target");
  }

  public restore(): any {
    return Promise.reject("Restore is not supported on the web target");
  }

  public getSyncDateTime(): Promise<SyncDateTime> {
    return this.syncDateTimeDao.findOne();
  }

  public updateSyncDateTime(syncDateTime: SyncDateTime): Promise<SyncDateTime> {
    return this.syncDateTimeDao.put(syncDateTime);
  }

  public clearSyncTime(): Promise<void> {
    return this.syncDateTimeDao.clear();
  }

  public redirect(): void {
    this.sync(false, false);
  }
}
