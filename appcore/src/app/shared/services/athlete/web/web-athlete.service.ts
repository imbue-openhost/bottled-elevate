import { Inject, Injectable } from "@angular/core";
import { AthleteDao } from "../../../dao/athlete/athlete.dao";
import { AthleteService } from "../athlete.service";

@Injectable()
export class WebAthleteService extends AthleteService {
  constructor(@Inject(AthleteDao) public readonly athleteModelDao: AthleteDao) {
    super(athleteModelDao);
  }
}
