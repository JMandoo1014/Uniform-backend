import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, SurveyOwnerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AdminAuditService } from './admin-audit.service';
import { ADMIN_ACTIONS, ADMIN_TARGET_TYPES } from './admin.constants';
import { generateNumberedName } from './admin-ranking.util';
import { RenameTeamDto } from './dto/rename-team.dto';
import { AdminTeamDto, AdminTeamRenamedDto } from './dto/admin-team.dto';

const TEAM_INCLUDE = {
  leader: { select: { nickname: true } },
  members: {
    orderBy: { joinedAt: 'asc' },
    include: { user: { select: { id: true, nickname: true, email: true } } },
  },
} satisfies Prisma.TeamInclude;

type TeamWithMembers = Prisma.TeamGetPayload<{ include: typeof TEAM_INCLUDE }>;

const TEAM_NAME_PREFIX = '팀';

@Injectable()
export class AdminTeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly mail: MailService,
  ) {}

  async listTeams(): Promise<AdminTeamDto[]> {
    const teams = await this.prisma.team.findMany({
      include: TEAM_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return this.toTeamDtos(teams);
  }

  async getTeam(teamId: string): Promise<AdminTeamDto> {
    const [dto] = await this.toTeamDtos([await this.findTeamOrThrow(teamId)]);
    return dto;
  }

  // 관리자 콘솔 "팀 이름 강제 변경" — "팀+숫자 5자리"로 바꾸고 팀원 전체에게
  // 알린다. 팀 설문의 게시 명의는 팀 이름을 그대로 따라가므로 따로 고칠 게 없다.
  async renameTeam(
    adminId: string,
    teamId: string,
    dto: RenameTeamDto,
  ): Promise<AdminTeamRenamedDto> {
    const team = await this.findTeamOrThrow(teamId);
    const name = generateNumberedName(TEAM_NAME_PREFIX);
    const message = `운영 정책에 따라 팀 이름이 "${team.name}"에서 "${name}"(으)로 변경되었습니다.`;
    const members = team.members.map((m) => m.user);

    await this.prisma.$transaction(async (tx) => {
      await tx.team.update({ where: { id: teamId }, data: { name } });
      await tx.notification.createMany({
        data: members.map((m) => ({
          userId: m.id,
          type: NotificationType.TEAM_NAME_FORCED,
          message,
          targetUrl: '/team',
        })),
      });
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.TEAM_RENAME,
          targetType: ADMIN_TARGET_TYPES.TEAM,
          targetId: teamId,
          targetName: team.name,
          reason: dto.reason,
          memo: dto.memo,
          beforeValue: team.name,
          afterValue: name,
        },
        tx,
      );
    });

    void Promise.all(
      members
        .filter((m) => m.email)
        .map((m) =>
          this.mail.sendNotice(m.email!, '팀 이름 변경 안내', message),
        ),
    );
    return { name };
  }

  private async findTeamOrThrow(teamId: string): Promise<TeamWithMembers> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: TEAM_INCLUDE,
    });
    if (!team) {
      throw new NotFoundException('팀을 찾을 수 없습니다.');
    }
    return team;
  }

  private async toTeamDtos(teams: TeamWithMembers[]): Promise<AdminTeamDto[]> {
    if (teams.length === 0) return [];
    const surveyGroups = await this.prisma.survey.groupBy({
      by: ['ownerId'],
      where: {
        ownerType: SurveyOwnerType.TEAM,
        ownerId: { in: teams.map((t) => t.id) },
      },
      _count: { _all: true },
    });
    const surveyCounts = new Map(
      surveyGroups.map((g) => [g.ownerId, g._count._all]),
    );
    return teams.map(
      (t) =>
        new AdminTeamDto({
          id: t.id,
          name: t.name,
          leaderId: t.leaderId,
          leaderNickname: t.leader.nickname,
          createdAt: t.createdAt.toISOString(),
          disbandedAt: t.disbandedAt?.toISOString() ?? null,
          members: t.members.map((m) => ({
            id: m.user.id,
            nickname: m.user.nickname,
          })),
          surveyCount: surveyCounts.get(t.id) ?? 0,
        }),
    );
  }
}
