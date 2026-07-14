import { RouterModule, Routes } from "@angular/router";
import { NgModule } from "@angular/core";
import { ActivityViewComponent } from "./activity-view.component";
import { ActivityCompareComponent } from "../activity-compare/activity-compare.component";

const routes: Routes = [
  {
    path: "compare/:ids",
    component: ActivityCompareComponent
  },
  {
    path: ":id",
    component: ActivityViewComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ActivityViewRoutingModule {}
