import { Prisma } from '@prisma/client';

export type TeamWithMembers = Prisma.TeamGetPayload<{
  include: {
    leader: { select: { nickname: true } };
    members: { include: { user: { select: { id: true; nickname: true } } } };
  };
}>;

class TeamMemberResponseDto {
  userId: string;
  nickname: string | null;
  joinedAt: string;
  isLeader: boolean;

  constructor(member: TeamWithMembers['members'][number], leaderId: string) {
    this.userId = member.user.id;
    this.nickname = member.user.nickname;
    this.joinedAt = member.joinedAt.toISOString();
    this.isLeader = member.user.id === leaderId;
  }
}

// Spec 3.1: 팀 화면은 현재 팀원만 볼 수 있고, 초대 링크는 팀장에게만 노출한다.
export class TeamDetailResponseDto {
  id: string;
  name: string;
  leaderId: string;
  leaderNickname: string | null;
  memberCount: number;
  members: TeamMemberResponseDto[];
  inviteToken: string | null;
  createdAt: string;

  constructor(team: TeamWithMembers, viewerId: string) {
    this.id = team.id;
    this.name = team.name;
    this.leaderId = team.leaderId;
    this.leaderNickname = team.leader.nickname;
    this.memberCount = team.members.length;
    this.members = team.members
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((member) => new TeamMemberResponseDto(member, team.leaderId));
    this.inviteToken = team.leaderId === viewerId ? team.inviteToken : null;
    this.createdAt = team.createdAt.toISOString();
  }
}
