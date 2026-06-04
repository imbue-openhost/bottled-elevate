import { ErrorHandler, NgModule } from "@angular/core";
import { MENU_ITEMS_PROVIDER } from "../shared/services/menu-items/menu-items-provider.interface";
import { ExtensionMenuItemsProvider } from "../shared/services/menu-items/impl/extension-menu-items-provider.service";
import { TOP_BAR_COMPONENT } from "../top-bar/top-bar.component";
import { ExtensionTopBarComponent } from "../top-bar/extension-top-bar.component";
import { AppLoadService } from "../app-load/app-load.service";
import { ExtensionLoadService } from "../app-load/extension/extension-load.service";
import { APP_MORE_MENU_COMPONENT } from "../app-more-menu/app-more-menu.component";
import { ExtensionAppMoreMenuComponent } from "../app-more-menu/extension-app-more-menu.component";
import { SYNC_BAR_COMPONENT } from "../sync-bar/sync-bar.component";
import { WebSyncBarComponent } from "../sync-bar/web-sync-bar.component";
import { ExtensionRecalculateActivitiesBarComponent } from "../recalculate-activities-bar/extension-recalculate-activities-bar.component";
import { RECALCULATE_ACTIVITIES_BAR_COMPONENT } from "../recalculate-activities-bar/recalculate-activities-bar.component";
import { SYNC_MENU_COMPONENT } from "../sync-menu/sync-menu.component";
import { WebSyncMenuComponent } from "../sync-menu/web/web-sync-menu.component";
import { CoreModule } from "../core/core.module";
import { AppService } from "../shared/services/app-service/app.service";
import { WebAppService } from "../shared/services/app-service/web/web-app.service";
import { UPDATE_BAR_COMPONENT } from "../update-bar/update-bar.component";
import { ExtensionUpdateBarComponent } from "../update-bar/extension-update-bar.component";
import { ExtensionSplashScreenComponent } from "../app-load/extension/extension-splash-screen.component";
import { SPLASH_SCREEN_COMPONENT } from "../app-load/splash-screen.component";
import { ExtensionElevateErrorHandler } from "../errors-handler/extension-elevate-error-handler";
import { WebRoutingModule } from "../shared/modules/routing/web-routing.module";

@NgModule({
  imports: [CoreModule, WebRoutingModule],
  exports: [CoreModule, WebRoutingModule],
  declarations: [
    ExtensionSplashScreenComponent,
    ExtensionRecalculateActivitiesBarComponent,
    ExtensionUpdateBarComponent,
    WebSyncBarComponent,
    ExtensionTopBarComponent,
    ExtensionAppMoreMenuComponent,
    WebSyncMenuComponent
  ],
  providers: [
    { provide: ErrorHandler, useClass: ExtensionElevateErrorHandler },
    { provide: SPLASH_SCREEN_COMPONENT, useValue: ExtensionSplashScreenComponent },
    { provide: AppLoadService, useClass: ExtensionLoadService },
    { provide: AppService, useClass: WebAppService },
    { provide: MENU_ITEMS_PROVIDER, useClass: ExtensionMenuItemsProvider },
    { provide: UPDATE_BAR_COMPONENT, useValue: ExtensionUpdateBarComponent },
    { provide: SYNC_BAR_COMPONENT, useValue: WebSyncBarComponent },
    { provide: RECALCULATE_ACTIVITIES_BAR_COMPONENT, useValue: ExtensionRecalculateActivitiesBarComponent },
    { provide: TOP_BAR_COMPONENT, useValue: ExtensionTopBarComponent },
    { provide: APP_MORE_MENU_COMPONENT, useValue: ExtensionAppMoreMenuComponent },
    { provide: SYNC_MENU_COMPONENT, useValue: WebSyncMenuComponent }
  ]
})
export class TargetBootModule {}
