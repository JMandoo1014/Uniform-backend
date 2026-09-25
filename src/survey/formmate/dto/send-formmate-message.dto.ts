import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { FORMMATE_MESSAGE_MAX_LENGTH } from '../formmate.constants';

// 메시지당 유료 외부 API(Gemini) 호출이 붙으므로 길이를 제한한다.
export class SendFormMateMessageDto {
  @IsString()
  @IsNotEmpty({ message: '메시지를 입력해주세요.' })
  @MaxLength(FORMMATE_MESSAGE_MAX_LENGTH, {
    message: `메시지는 ${FORMMATE_MESSAGE_MAX_LENGTH}자 이하로 입력해주세요.`,
  })
  message: string;
}
