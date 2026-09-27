import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { AdminActionNoteDto } from './admin-action-note.dto';

// Spec 6.3/10.4: 리더보드 상단 보상 안내 — 제목/설명/1~3위 보상/동점 규칙.
export class UpdateAnnouncementDto extends AdminActionNoteDto {
  @IsString()
  @IsNotEmpty({ message: '보상 안내 제목을 입력해주세요.' })
  @MaxLength(100)
  title: string;

  @IsString()
  @MaxLength(500)
  body: string;

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tiers: string[];

  @IsString()
  @MaxLength(300)
  tieRule: string;
}
