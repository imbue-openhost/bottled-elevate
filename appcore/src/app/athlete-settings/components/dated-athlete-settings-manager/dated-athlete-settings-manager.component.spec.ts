import { ComponentFixture, TestBed } from "@angular/core/testing";
import { DatedAthleteSettingsManagerComponent } from "./dated-athlete-settings-manager.component";
import { CoreModule } from "../../../core/core.module";
import { SharedModule } from "../../../shared/shared.module";
import { AthleteSettingsModule } from "../../athlete-settings.module";
import { AthleteService } from "../../../shared/services/athlete/athlete.service";
import { DataStore } from "../../../shared/data-store/data-store";
import { TestingDataStore } from "../../../shared/data-store/testing-datastore.service";
import { TargetModule } from "../../../shared/modules/target/web-target.module";
import { TargetBootModule } from "../../../boot/web-boot.module";
import { DatedAthleteSettings } from "@elevate/shared/models/athlete/athlete-settings/dated-athlete-settings.model";
import { AthleteSettings } from "@elevate/shared/models/athlete/athlete-settings/athlete-settings.model";
import { Gender } from "@elevate/shared/models/athlete/gender.enum";
import { AthleteModel } from "@elevate/shared/models/athlete/athlete.model";

describe("DatedAthleteSettingsManagerComponent", () => {
  let component: DatedAthleteSettingsManagerComponent;
  let fixture: ComponentFixture<DatedAthleteSettingsManagerComponent>;

  beforeEach(done => {
    TestBed.configureTestingModule({
      imports: [CoreModule, SharedModule, TargetBootModule, TargetModule, AthleteSettingsModule],
      providers: [
        { provide: DataStore, useClass: TestingDataStore },
      ]
    }).compileComponents();

    const athleteService = TestBed.inject(AthleteService);

    const datedAthleteSettings: DatedAthleteSettings[] = [
      new DatedAthleteSettings("2018-05-10", new AthleteSettings(200, 50, null, 190, null, null, 75)),
      new DatedAthleteSettings("2018-04-15", new AthleteSettings(195, null, null, 150, null, null, 76)),
      new DatedAthleteSettings("2018-02-01", new AthleteSettings(190, 65, null, 110, null, null, 78)),
      new DatedAthleteSettings(null, new AthleteSettings(190, 65, null, 110, null, null, 78))
    ];

    const athleteModel = new AthleteModel(Gender.MEN, datedAthleteSettings);

    spyOn(athleteService, "fetch").and.returnValue(Promise.resolve(athleteModel));

    done();
  });

  beforeEach(done => {
    fixture = TestBed.createComponent(DatedAthleteSettingsManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    done();
  });

  it("should create", done => {
    expect(component).toBeTruthy();
    done();
  });
});
