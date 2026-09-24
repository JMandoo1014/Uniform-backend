import { IsValidNickname } from '../../common/validators/nickname.validator';

// Spec 10.3 / 2.3: 강제 변경도 일반 닉네임 규칙(2~12자, 한글/영문/숫자)을 그대로 적용한다.
export class NicknameForceChangeDto {
  @IsValidNickname()
  newNickname: string;
}
