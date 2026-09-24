import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { AccountNotActiveException } from '../common/exceptions/business.exception';
import { SurveyService } from './survey.service';

// Spec 4.5 step 1: publish() must reject any account that isn't ACTIVE before
// it ever looks at the survey itself.
describe('SurveyService.publish — active account gate', () => {
  let service: SurveyService;
  let prisma: {
    user: { findUnique: jest.Mock };
    survey: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      survey: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurveyService,
        { provide: PrismaService, useValue: prisma },
        { provide: TeamService, useValue: {} },
      ],
    }).compile();

    service = module.get<SurveyService>(SurveyService);
  });

  it.each([
    UserStatus.RESTRICTED,
    UserStatus.PENDING_VERIFICATION,
    UserStatus.WITHDRAWN,
  ])(
    'rejects with AccountNotActiveException when account status is %s',
    async (status) => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', status });

      await expect(
        service.publish('user-1', 'survey-1'),
      ).rejects.toBeInstanceOf(AccountNotActiveException);
      expect(prisma.survey.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects with AccountNotActiveException when the account no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.publish('user-1', 'survey-1')).rejects.toBeInstanceOf(
      AccountNotActiveException,
    );
    expect(prisma.survey.findUnique).not.toHaveBeenCalled();
  });

  it('lets ACTIVE accounts through to the survey lookup', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: UserStatus.ACTIVE,
    });
    prisma.survey.findUnique.mockResolvedValue(null);

    // A missing survey fails later, at findOwnedSurveyOrThrow — proving control
    // passed the active-account gate instead of stopping there.
    await expect(service.publish('user-1', 'survey-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.survey.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'survey-1' } }),
    );
  });
});
