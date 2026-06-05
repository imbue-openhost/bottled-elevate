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
import { SplitCalculator } from "@elevate/shared/sync/compute/split-calculator";

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

  // Best-splits ran in the Electron main process; run the same SplitCalculator client-side.
  public computeSplit(splitRequest: SplitRequest): Promise<SplitResponse> {
    const scale = splitRequest.scaleStream || [];
    const results: { streamKey: string; value: number; indexes: number[] }[] = [];
    for (const dataStream of splitRequest.dataStreams || []) {
      if (!dataStream?.stream?.length || scale.length < 2) {
        continue;
      }
      try {
        const best = new SplitCalculator(scale, dataStream.stream).compute(splitRequest.range);
        if (best.value !== null && isFinite(best.value)) {
          results.push({ streamKey: dataStream.streamKey, value: best.value, indexes: [best.start, best.end] });
        }
      } catch {
        // Range longer than the activity (or invalid stream) — skip this one.
      }
    }
    return Promise.resolve({ type: splitRequest.type, range: splitRequest.range, results });
  }

  public removeById(id: number | string): Promise<void> {
    return super.removeById(id).then(() => this.streamsService.removeById(id));
  }
}
