import { Inject, Injectable } from "@angular/core";
import { ActivityService } from "../activity.service";
import { ActivityDao } from "../../../dao/activity/activity.dao";
import { AthleteSnapshotResolverService } from "../../athlete-snapshot-resolver/athlete-snapshot-resolver.service";
import { StreamsService } from "../../streams/streams.service";
import { LoggerService } from "../../logging/logger.service";
import { Activity } from "@elevate/shared/models/sync/activity.model";
import { AthleteSnapshot } from "@elevate/shared/models/athlete/athlete-snapshot.model";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";
import { SplitRequest } from "@elevate/shared/models/splits/split-request.model";
import { SplitResponse } from "@elevate/shared/models/splits/split-response.model";

@Injectable()
export class WebActivityService extends ActivityService {
  constructor(
    @Inject(ActivityDao) public readonly activityDao: ActivityDao,
    @Inject(AthleteSnapshotResolverService) public readonly athleteSnapshotResolver: AthleteSnapshotResolverService,
    @Inject(StreamsService) public readonly streamsService: StreamsService,
    @Inject(LoggerService) protected readonly logger: LoggerService
  ) {
    super(activityDao, athleteSnapshotResolver, logger);
  }

  // Web has no compute worker (that was Electron IPC). Activities arrive pre-summarised from the
  // health-data service, so "recalculate" just re-stamps the athlete snapshot and persists.
  public recalculateSingle(activity: Activity, _userSettings: UserSettings.BaseUserSettings): Promise<Activity> {
    return this.athleteSnapshotResolver.update().then(() => {
      const athleteSnapshot: AthleteSnapshot = this.athleteSnapshotResolver.resolve(new Date(activity.startTime));
      activity.athleteSnapshot = athleteSnapshot;
      activity.lastEditTime = new Date().toISOString();
      return this.put(activity);
    });
  }

  // Best-splits computation ran in the Electron main process; not available on web yet.
  public computeSplit(_splitRequest: SplitRequest): Promise<SplitResponse> {
    return Promise.resolve({ results: [] } as SplitResponse);
  }

  public removeById(id: number | string): Promise<void> {
    return super.removeById(id).then(() => this.streamsService.removeById(id));
  }
}
