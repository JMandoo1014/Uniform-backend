import { Prisma } from '@prisma/client';

export type TeamListItem = Prisma.TeamGetPayload<{
  include: {
    leader: { select: { nickname: true } };
    _count: { select: { members: true } };
  };
}>;

// Spec 3.1 팀 화면: 팀별 팀원 수만 보여주면 되므로 전체 멤버 목록은 담지 않는다.
export class TeamListItemResponseDto {
  id: string;
  name: string;
  leaderId: string;
  leaderNickname: string | null;
  memberCount: number;
  isLeader: boolean;
  createdAt: string;

  constructor(team: TeamListItem, viewerId: string) {
    this.id = team.id;
    this.name = team.name;
    this.leaderId = team.leaderId;
    this.leaderNickname = team.leader.nickname;
    this.memberCount = team._count.members;
    this.isLeader = team.leaderId === viewerId;
    this.createdAt = team.createdAt.toISOString();
  }
}
