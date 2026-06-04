import { Inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { OpenResourceResolver } from "../open-resource-resolver";
import { AppRoutes } from "../../../models/app-routes";

@Injectable()
export class WebOpenResourceResolver extends OpenResourceResolver {
  constructor(
    @Inject(Router) private readonly router: Router,
    @Inject(MatSnackBar) protected readonly snackBar: MatSnackBar
  ) {
    super(snackBar);
  }

  public openActivity(id: number | string): Promise<boolean> {
    return this.router.navigate([AppRoutes.activity, id]);
  }

  public openLink(url: string): Promise<void> {
    window.open(url, "_blank");
    return Promise.resolve();
  }
}
