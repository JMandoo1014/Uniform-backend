import { IsNotEmpty, IsString } from 'class-validator';

export class SendFormMateMessageDto {
  @IsString()
  @IsNotEmpty({ message: '메시지를 입력해주세요.' })
  message: string;
}
