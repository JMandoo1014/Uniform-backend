import { FormMateProposedChangeResponseDto } from './formmate-proposed-change-response.dto';

export class SendFormMateMessageResponseDto {
  aiReply: string;
  proposedChanges: FormMateProposedChangeResponseDto[];
  // 제목/설명은 changeIds로 고르는 흐름이 없다 — FormMate가 이번 턴에 제안과
  // 함께 draft에 바로 반영했을 때만 그 새 값을 실어준다(프론트가 폼 필드를
  // 즉시 갱신할 수 있도록). 반영 안 됐으면(관련 없는 요청이었거나, 버전 충돌로
  // 이번 턴엔 건너뛰었으면) 필드 자체를 생략한다.
  updatedTitle?: string;
  updatedDescription?: string;

  constructor(
    aiReply: string,
    changes: ConstructorParameters<
      typeof FormMateProposedChangeResponseDto
    >[0][],
    updatedTitle?: string,
    updatedDescription?: string,
  ) {
    this.aiReply = aiReply;
    this.proposedChanges = changes.map(
      (change) => new FormMateProposedChangeResponseDto(change),
    );
    if (updatedTitle !== undefined) {
      this.updatedTitle = updatedTitle;
    }
    if (updatedDescription !== undefined) {
      this.updatedDescription = updatedDescription;
    }
  }
}
