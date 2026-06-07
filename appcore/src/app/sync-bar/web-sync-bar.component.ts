import { Component, HostBinding, Inject, OnInit } from "@angular/core";
import { SyncBarComponent } from "./sync-bar.component";
import { SyncProgress, SyncService } from "../shared/services/sync/sync.service";

@Component({
  selector: "app-web-sync-bar",
  template: `
    <div class="app-sync-bar">
      <div fxLayout="row" fxLayoutAlign="space-between center" class="ribbon">
        <div fxLayout="column" fxLayoutAlign="center start">
          <span fxFlex class="mat-body-1">{{ label }}</span>
        </div>
        <div fxLayout="row" fxLayoutAlign="space-between center">
          <button mat-button (click)="onActionStop()" matTooltip="Stop syncing (resumes next time)">
            <mat-icon fontSet="material-icons-outlined">stop</mat-icon>
            Stop
          </button>
          <button mat-icon-button (click)="onActionClose()">
            <mat-icon fontSet="material-icons-outlined">close</mat-icon>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .ribbon {
        padding: 10px 20px;
      }
    `
  ]
})
export class WebSyncBarComponent extends SyncBarComponent implements OnInit {
  @HostBinding("hidden")
  public hiddenSyncBar: boolean;

  public label: string;

  constructor(@Inject(SyncService) private readonly syncService: SyncService<any>) {
    super();
    this.hiddenSyncBar = true;
    this.label = "Syncing activities from your health data…";
  }

  public ngOnInit(): void {
    this.syncService.isSyncing$.subscribe(isSyncing => {
      this.hiddenSyncBar = !isSyncing;
    });
    this.syncService.syncProgress$.subscribe((progress: SyncProgress | null) => {
      this.label =
        progress && progress.total > 0
          ? `Syncing activities… ${progress.imported}/${progress.total}`
          : "Syncing activities from your health data…";
    });
  }

  public onActionStop(): void {
    this.syncService.stop();
  }

  public onActionClose(): void {
    this.hiddenSyncBar = true;
  }
}
