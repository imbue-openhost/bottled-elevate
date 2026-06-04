import { Inject, Injectable } from "@angular/core";
import { AppService } from "../app.service";
import { ActivityService } from "../../activity/activity.service";
import { SyncService } from "../../sync/sync.service";

@Injectable()
export class WebAppService extends AppService {
  constructor(
    @Inject(ActivityService) protected readonly activityService: ActivityService,
    @Inject(SyncService) public readonly syncService: SyncService<any>
  ) {
    super(activityService, syncService);
  }
}
