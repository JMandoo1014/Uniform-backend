import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccountNotActiveException,
  AlreadyTeamMemberException,
  InvalidInviteTokenException,
  LeaderMustTransferBeforeLeavingException,
  NotTeamLeaderException,
  NotTeamMemberException,
  TeamFullException,
  TeamJoinLimitExceededException,
} from '../common/exceptions/business.exception';
import { CreateTeamDto } from './dto/create-team.dto';
import { JoinTeamDto } from './dto/join-team.dto';
import { TransferLeaderDto } from './dto/transfer-leader.dto';
import {
  TeamDetailResponseDto,
  TeamWithMembers,
} from './dto/team-detail-response.dto';
import { TeamListItemResponseDto } from './dto/team-list-item-response.dto';
import { MAX_TEAM_MEMBERS, MAX_TEAMS_PER_USER } from './team.constants';

const TEAM_WITH_MEMBERS_INCLUDE = {
  leader: { select: { nickname: true } },
  members: { include: { user: { select: { id: true, nickname: true } } } },
} satisfies Prisma.TeamInclude;

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  // Spec 3.1: 활성 회원 누구나 만들 수 있고, 만든 사람이 팀장이자 팀원으로 카운트된다.
  async createTeam(
    userId: string,
    dto: CreateTeamDto,
  ): Promise<TeamDetailResponseDto> {
    await this.assertActiveUser(userId);
    await this.assertUnderTeamLimit(userId);

    const team = await this.prisma.team.create({
      data: {
        name: dto.name,
        leaderId: userId,
        members: { create: { userId } },
      },
      include: TEAM_WITH_MEMBERS_INCLUDE,
    });

    return new TeamDetailResponseDto(team, userId);
  }

  async listMyTeams(userId: string): Promise<TeamListItemResponseDto[]> {
    const teams = await this.prisma.team.findMany({
      where: { disbandedAt: null, members: { some: { userId } } },
      include: {
        leader: { select: { nickname: true } },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return teams.map((team) => new TeamListItemResponseDto(team, userId));
  }

  // Spec 3.1: 현재 팀원이 아니면 403, 초대 링크는 팀장에게만 노출.
  async getTeamDetail(
    userId: string,
    teamId: string,
  ): Promise<TeamDetailResponseDto> {
    const team = await this.findActiveTeamOrThrow(teamId);
    this.assertIsMember(team, userId);
    return new TeamDetailResponseDto(team, userId);
  }

  // Spec 3.1: 팀장은 언제든 링크를 새로 만들어 이전 링크를 무효로 할 수 있다.
  async regenerateInviteToken(
    userId: string,
    teamId: string,
  ): Promise<TeamDetailResponseDto> {
    const team = await this.findActiveTeamOrThrow(teamId);
    this.assertIsLeader(team, userId);

    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data: { inviteToken: randomUUID() },
      include: TEAM_WITH_MEMBERS_INCLUDE,
    });

    return new TeamDetailResponseDto(updated, userId);
  }

  // Spec 3.1: 초대 링크로만 가입, 인원 초과·3개 팀 초과·무효 토큰은 거부.
  async joinTeam(
    userId: string,
    dto: JoinTeamDto,
  ): Promise<TeamDetailResponseDto> {
    await this.assertActiveUser(userId);

    const team = await this.prisma.team.findFirst({
      where: { inviteToken: dto.inviteToken, disbandedAt: null },
      include: TEAM_WITH_MEMBERS_INCLUDE,
    });
    if (!team) {
      throw new InvalidInviteTokenException();
    }

    if (team.members.some((member) => member.userId === userId)) {
      throw new AlreadyTeamMemberException();
    }
    if (team.members.length >= MAX_TEAM_MEMBERS) {
      throw new TeamFullException();
    }
    await this.assertUnderTeamLimit(userId);

    await this.prisma.teamMember.create({ data: { teamId: team.id, userId } });

    const updated = await this.prisma.team.findUniqueOrThrow({
      where: { id: team.id },
      include: TEAM_WITH_MEMBERS_INCLUDE,
    });
    return new TeamDetailResponseDto(updated, userId);
  }

  // Spec 3.4: 본인이 나가는 경우 팀장이면 거부, 팀장이 내보내는 경우만 타인 제거 가능.
  async removeMember(
    requesterId: string,
    teamId: string,
    targetUserId: string,
  ): Promise<void> {
    const team = await this.findActiveTeamOrThrow(teamId);
    this.assertIsMember(team, requesterId);

    if (targetUserId === requesterId) {
      if (team.leaderId === requesterId) {
        throw new LeaderMustTransferBeforeLeavingException();
      }
    } else if (team.leaderId !== requesterId) {
      throw new NotTeamLeaderException();
    }

    const target = team.members.find(
      (member) => member.userId === targetUserId,
    );
    if (!target) {
      throw new NotFoundException('해당 팀원을 찾을 수 없습니다.');
    }

    await this.prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
  }

  // Spec 3.1: 팀장 넘기기는 현재 팀장만, 새 팀장은 현재 팀원이어야 한다.
  async transferLeader(
    userId: string,
    teamId: string,
    dto: TransferLeaderDto,
  ): Promise<TeamDetailResponseDto> {
    const team = await this.findActiveTeamOrThrow(teamId);
    this.assertIsLeader(team, userId);

    const isNewLeaderMember = team.members.some(
      (member) => member.userId === dto.newLeaderId,
    );
    if (!isNewLeaderMember) {
      throw new NotFoundException('현재 팀원만 팀장이 될 수 있습니다.');
    }

    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data: { leaderId: dto.newLeaderId },
      include: TEAM_WITH_MEMBERS_INCLUDE,
    });

    return new TeamDetailResponseDto(updated, userId);
  }

  // Spec 3.4: 해산은 팀장만. 팀 초안 이동/팀 설문 유지 로직은 Survey-Team 연동 시 채운다.
  async disbandTeam(userId: string, teamId: string): Promise<void> {
    const team = await this.findActiveTeamOrThrow(teamId);
    this.assertIsLeader(team, userId);

    await this.prisma.$transaction([
      this.prisma.team.update({
        where: { id: teamId },
        data: { disbandedAt: new Date() },
      }),
      this.prisma.teamMember.deleteMany({ where: { teamId } }),
    ]);

    // TODO(spec 3.4): 팀 초안을 해산 당시 팀장(leaderId)의 개인 초안으로 옮기고,
    // 모집 중인 팀 설문은 마감 시각까지 유지하되 관리 권한·결과 조회는 해산 당시
    // 팀장에게 남겨야 한다. Survey-Team 연동 단계에서 채운다.
  }

  private async assertActiveUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AccountNotActiveException();
    }
  }

  private async assertUnderTeamLimit(userId: string): Promise<void> {
    const teamCount = await this.prisma.teamMember.count({
      where: { userId, team: { disbandedAt: null } },
    });
    if (teamCount >= MAX_TEAMS_PER_USER) {
      throw new TeamJoinLimitExceededException();
    }
  }

  private async findActiveTeamOrThrow(
    teamId: string,
  ): Promise<TeamWithMembers> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: TEAM_WITH_MEMBERS_INCLUDE,
    });
    if (!team || team.disbandedAt) {
      throw new NotFoundException('팀을 찾을 수 없습니다.');
    }
    return team;
  }

  private assertIsMember(team: TeamWithMembers, userId: string): void {
    const isMember = team.members.some((member) => member.userId === userId);
    if (!isMember) {
      throw new NotTeamMemberException();
    }
  }

  private assertIsLeader(team: TeamWithMembers, userId: string): void {
    if (team.leaderId !== userId) {
      throw new NotTeamLeaderException();
    }
  }
}
