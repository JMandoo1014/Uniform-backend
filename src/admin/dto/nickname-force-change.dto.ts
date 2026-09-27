import { IsOptional } from 'class-validator';
import { IsValidNickname } from '../../common/validators/nickname.validator';
import { AdminActionNoteDto } from './admin-action-note.dto';

// Spec 10.3: "부적절한 닉네임을 임의 닉네임으로 바꾸고 알린다" — newNickname을
// 주지 않으면 서버가 "회원+숫자 5자리"로 만든다. 직접 지정할 때도 일반 닉네임
// 규칙(2~12자, 한글/영문/숫자)을 그대로 적용한다.
export class NicknameForceChangeDto extends AdminActionNoteDto {
  @IsOptional()
  @IsValidNickname()
  newNickname?: string;
}
