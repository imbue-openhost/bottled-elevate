import { Inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
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
import { buildActivityFromWorkout, ProviderWorkout } from "./web-activity-mapper";

/**
 * Web sync service for OpenHost. Pulls workouts from the health-data service (via the
 * same-origin proxy) and upserts them into the local IndexedDB store.
 *
 * A full sync fetches everything; a fast sync (used for auto-sync on load) only fetches
 * a recent window so subsequent loads stay quick. Upserts are idempotent (keyed on id).
 */
@Injectable()
export class WebSyncService extends SyncService<SyncDateTime> {
  public isSyncing: boolean;

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
    this.isSyncing$.subscribe(isSyncing => {
      this.isSyncing = isSyncing;
    });
  }

  public static readonly WORKOUTS_ENDPOINT: string = "/api/workouts";
  public static readonly WORKOUTS_LIMIT: number = 5000;
  // Fast sync re-fetches this trailing window (covers timezone skew + recently edited workouts).
  public static readonly FAST_SYNC_WINDOW_MS: number = 7 * 24 * 3600 * 1000;

  public async sync(fastSync: boolean, forceSync: boolean): Promise<void> {
    if (this.isSyncing) {
      return;
    }
    this.isSyncing$.next(true);
    try {
      if (forceSync) {
        await this.clearActivities();
      }

      const since = await this.resolveIncrementalStart(fastSync, forceSync);
      let url = `${environment.backendBaseUrl}${WebSyncService.WORKOUTS_ENDPOINT}?limit=${WebSyncService.WORKOUTS_LIMIT}`;
      if (since) {
        url += `&start=${encodeURIComponent(since)}`;
      }
      const response = await this.httpClient.get<{ data: ProviderWorkout[] }>(url).toPromise();
      const workouts = response?.data || [];
      this.logger.info(`Fetched ${workouts.length} workout(s) from health-data service${since ? ` since ${since}` : ""}`);

      // Refresh athlete snapshot resolver so each activity is stamped with the right settings.
      await this.activityService.athleteSnapshotResolver.update();

      let saved = 0;
      for (const workout of workouts) {
        if (!workout?.start || !workout?.end) {
          continue;
        }
        const snapshot = this.activityService.athleteSnapshotResolver.resolve(new Date(workout.start));
        const { activity, streams } = await buildActivityFromWorkout(workout, snapshot);
        await this.activityService.put(activity);
        if (streams) {
          await this.streamsService.put(new DeflatedActivityStreams(String(activity.id), Streams.deflate(streams)));
        } else {
          await this.streamsService.removeById(String(activity.id));
        }
        saved++;
      }

      await this.updateSyncDateTime(new SyncDateTime(Date.now()));
      await this.dataStore.persist(true);
      this.logger.info(`Sync done: ${saved} activity(ies) upserted`);
    } catch (error) {
      this.logger.error("WebSyncService.sync() failed", error);
      this.isSyncing$.next(false);
      return Promise.reject(error);
    }
    this.isSyncing$.next(false);
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
    return Promise.all([this.getSyncDateTime(), this.activityService.count()]).then(([syncDateTime, activitiesCount]) => {
      const hasSyncDateTime: boolean = syncDateTime && _.isNumber(syncDateTime.syncDateTime);
      const hasActivities: boolean = activitiesCount > 0;

      if (!hasSyncDateTime && !hasActivities) {
        return SyncState.NOT_SYNCED;
      } else if (!hasSyncDateTime && hasActivities) {
        return SyncState.PARTIALLY_SYNCED;
      }
      return SyncState.SYNCED;
    });
  }

  public stop(): Promise<void> {
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
