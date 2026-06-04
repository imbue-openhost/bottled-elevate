import { NgModule } from "@angular/core";
import { CoreModule } from "../../../core/core.module";
import { WebRoutingModule } from "../routing/web-routing.module";
import { DataStore } from "../../data-store/data-store";
import { WebDataStore } from "../../data-store/impl/web-data-store.service";
import { ActivityService } from "../../services/activity/activity.service";
import { WebActivityService } from "../../services/activity/impl/web-activity.service";
import { VersionsProvider } from "../../services/versions/versions-provider";
import { WebVersionsProvider } from "../../services/versions/impl/web-versions-provider.service";
import { OPEN_RESOURCE_RESOLVER } from "../../services/links-opener/open-resource-resolver";
import { WebOpenResourceResolver } from "../../services/links-opener/impl/web-open-resource-resolver.service";
import { SyncService } from "../../services/sync/sync.service";
import { WebSyncService } from "../../services/sync/impl/web-sync.service";
import { SyncDateTimeDao } from "../../dao/sync/sync-date-time.dao";
import { UserSettingsService } from "../../services/user-settings/user-settings.service";
import { WebUserSettingsService } from "../../services/user-settings/web/web-user-settings.service";
import { AthleteService } from "../../services/athlete/athlete.service";
import { WebAthleteService } from "../../services/athlete/web/web-athlete.service";
import { WindowService } from "../../services/window/window.service";
import { ExtensionWindowService } from "../../services/window/extension-window.service";

@NgModule({
  imports: [CoreModule, WebRoutingModule],
  exports: [CoreModule, WebRoutingModule],
  providers: [
    SyncDateTimeDao,
    WebSyncService,
    { provide: WindowService, useClass: ExtensionWindowService },
    { provide: AthleteService, useClass: WebAthleteService },
    { provide: UserSettingsService, useClass: WebUserSettingsService },
    { provide: DataStore, useClass: WebDataStore },
    { provide: ActivityService, useClass: WebActivityService },
    { provide: VersionsProvider, useClass: WebVersionsProvider },
    { provide: OPEN_RESOURCE_RESOLVER, useClass: WebOpenResourceResolver },
    { provide: SyncService, useClass: WebSyncService }
  ]
})
export class TargetModule {}
