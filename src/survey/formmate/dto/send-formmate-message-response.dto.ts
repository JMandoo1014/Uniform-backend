import { FormMateProposedChangeResponseDto } from './formmate-proposed-change-response.dto';

export class SendFormMateMessageResponseDto {
  aiReply: string;
  proposedChanges: FormMateProposedChangeResponseDto[];

  constructor(
    aiReply: string,
    changes: ConstructorParameters<
      typeof FormMateProposedChangeResponseDto
    >[0][],
  ) {
    this.aiReply = aiReply;
    this.proposedChanges = changes.map(
      (change) => new FormMateProposedChangeResponseDto(change),
    );
  }
}
