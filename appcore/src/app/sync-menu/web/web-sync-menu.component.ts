import { Component, Inject, OnInit } from "@angular/core";
import { SyncMenuComponent } from "../sync-menu.component";
import { Router } from "@angular/router";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { SyncState } from "../../shared/services/sync/sync-state.enum";
import { AppRoutes } from "../../shared/models/app-routes";
import { SyncProgress, SyncService } from "../../shared/services/sync/sync.service";
import { AppService } from "../../shared/services/app-service/app.service";
import { ConfirmDialogDataModel } from "../../shared/dialogs/confirm-dialog/confirm-dialog-data.model";
import { ConfirmDialogComponent } from "../../shared/dialogs/confirm-dialog/confirm-dialog.component";

@Component({
  selector: "app-web-sync-menu",
  template: `
    <div *ngIf="syncState !== null">
      <div class="dual-split-button">
        <button
          mat-button
          [disabled]="appService.isSyncing"
          color="primary"
          (click)="syncMenuActions[0].action()"
          matTooltip="{{ appService.isSyncing ? 'Sync in progress…' : syncMenuActions[0]?.tooltip }}"
        >
          <mat-icon fontSet="material-icons-outlined" [class.spin]="appService.isSyncing">
            {{ appService.isSyncing ? "sync" : syncMenuActions[0].icon }}
          </mat-icon>
          {{ appService.isSyncing ? syncingLabel() : syncMenuActions[0].text }}
        </button>
        <button mat-icon-button color="primary" [disabled]="appService.isSyncing" [matMenuTriggerFor]="syncMenu">
          <mat-icon fontSet="material-icons-outlined">expand_more</mat-icon>
        </button>
      </div>
      <mat-menu #syncMenu="matMenu">
        <button *ngFor="let menuAction of syncMenuActions.slice(1)" mat-menu-item (click)="menuAction.action()">
          <mat-icon fontSet="material-icons-outlined">{{ menuAction.icon }}</mat-icon>
          {{ menuAction.text }}
        </button>
      </mat-menu>
    </div>
  `,
  styles: [
    `
      .spin {
        animation: sync-menu-spin 1.2s linear infinite;
      }
      @keyframes sync-menu-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `
  ]
})
export class WebSyncMenuComponent extends SyncMenuComponent implements OnInit {
  private progress: SyncProgress | null = null;

  constructor(
    @Inject(AppService) public readonly appService: AppService,
    @Inject(Router) protected readonly router: Router,
    @Inject(SyncService) protected readonly syncService: SyncService<any>,
    @Inject(MatDialog) protected readonly dialog: MatDialog,
    @Inject(MatSnackBar) protected readonly snackBar: MatSnackBar
  ) {
    super(appService, router, syncService, dialog, snackBar);
  }

  public ngOnInit(): void {
    super.ngOnInit();
    this.syncService.syncProgress$.subscribe(progress => (this.progress = progress));
  }

  public syncingLabel(): string {
    return this.progress && this.progress.total > 0
      ? `Syncing… ${this.progress.imported}/${this.progress.total}`
      : "Sync in progress…";
  }

  protected updateSyncMenu(): void {
    super.updateSyncMenu();

    if (this.syncState === SyncState.SYNCED) {
      this.syncMenuActions.push({ icon: "sync", text: "Sync activities", action: () => this.onSync(false, false) });
    }

    if (this.syncState === SyncState.PARTIALLY_SYNCED) {
      this.syncMenuActions.push({
        icon: "sync_problem",
        text: "Continue sync",
        tooltip: "Sync isn't finished. Click to continue.",
        action: () => this.onSync(false, false)
      });
    }

    if (this.syncState === SyncState.PARTIALLY_SYNCED || this.syncState === SyncState.SYNCED) {
      this.syncMenuActions.push({
        icon: "redo",
        text: "Clear and re-sync activities",
        action: () => this.onSync(false, true)
      });
      this.syncMenuActions.push({
        icon: "clear",
        text: "Clear synced activities",
        action: () => this.onClearSyncedData()
      });
    }

    if (this.syncState === SyncState.NOT_SYNCED) {
      this.syncMenuActions.push({
        icon: "sync_disabled",
        text: "Sync your activities",
        action: () => this.onSync(false, false)
      });
    }
  }

  protected updateSyncStatus(): void {
    this.syncService.getSyncState().then((syncState: SyncState) => {
      this.syncState = syncState;
      this.updateSyncMenu();
    });
  }

  // Backup/restore aren't supported on the web target: the health-data service is the
  // source of truth, so re-syncing rebuilds the local store.
  public onBackup(): void {
    this.snackBar.open("Backup isn't available on the web app — your data lives in the health-data service.", "Ok", {
      duration: 8000
    });
  }

  public onSync(fastSync: boolean, forceSync: boolean): void {
    if (this.syncState === SyncState.NOT_SYNCED) {
      const data: ConfirmDialogDataModel = {
        title: "First synchronisation",
        content:
          "This pulls your workouts from the OpenHost health-data service. Set up your athlete settings " +
          "(FTP, heart rate, …) first for the most accurate results.",
        confirmText: "Start sync",
        cancelText: "Check my athlete settings"
      };

      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        minWidth: ConfirmDialogComponent.MIN_WIDTH,
        maxWidth: "50%",
        data: data
      });

      const afterClosedSubscription = dialogRef.afterClosed().subscribe((confirm: boolean) => {
        if (confirm) {
          this.syncService.sync(fastSync, forceSync);
        } else {
          this.router.navigate([AppRoutes.athleteSettings]);
        }
        afterClosedSubscription.unsubscribe();
      });
    } else {
      this.syncService.sync(fastSync, forceSync);
    }
  }
}
