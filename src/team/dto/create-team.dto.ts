import { IsString, Length } from 'class-validator';
import { TEAM_NAME_MAX_LENGTH, TEAM_NAME_MIN_LENGTH } from '../team.constants';

// Spec 3.1: 활성 회원 누구나 팀 이름(2~20자)을 정해 만든다.
export class CreateTeamDto {
  @IsString()
  @Length(TEAM_NAME_MIN_LENGTH, TEAM_NAME_MAX_LENGTH, {
    message: `팀 이름은 ${TEAM_NAME_MIN_LENGTH}~${TEAM_NAME_MAX_LENGTH}자여야 합니다.`,
  })
  name: string;
}
