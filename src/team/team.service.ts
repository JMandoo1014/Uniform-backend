import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccountNotActiveException,
  NotTeamMemberException,
  TeamJoinLimitExceededException,
} from '../common/exceptions/business.exception';
import { CreateTeamDto } from './dto/create-team.dto';
import {
  TeamDetailResponseDto,
  TeamWithMembers,
} from './dto/team-detail-response.dto';
import { TeamListItemResponseDto } from './dto/team-list-item-response.dto';
import { MAX_TEAMS_PER_USER } from './team.constants';

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
}
