import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { parseCorsOrigin } from './common/utils/cors-origin.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 프론트(Vite dev server 등 다른 origin)에서 API를 직접 호출할 수 있도록 허용.
  // CORS_ORIGIN을 쉼표로 구분해 여러 origin을 지정할 수 있고(프로덕션 도메인 +
  // 팀원 로컬 dev server 등), "*"가 들어간 항목은 Cloudflare Pages 프리뷰
  // 서브도메인(브랜치/커밋마다 달라짐)처럼 가변 서브도메인을 정규식으로
  // 통째로 허용한다(parseCorsOrigin 참고). 안 정해져 있으면 개발 편의를 위해
  // 모든 origin을 허용한다(인증은 쿠키가 아니라 Authorization 헤더의 Bearer
  // 토큰을 쓰므로 credentials는 필요 없다).
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: parseCorsOrigin(corsOrigin),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // 운영/개발 구분 없이 항상 열어둔다 — 문서만 보이는 것이고 실제 호출은 여전히
  // JWT가 필요하므로 문제없다는 결정.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Uni-Form API')
    .setDescription(
      '대학(원)생 대상 설문조사 플랫폼 Uni-Form의 백엔드 API 문서',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument);

  // 기본은 127.0.0.1에만 바인딩한다 — 외부 요청은 호스트 nginx를 거쳐서만 들어온다.
  // 컨테이너처럼 다른 호스트(compose nginx)가 붙어야 하면 HOST=0.0.0.0으로 연다.
  await app.listen(process.env.PORT ?? 3000, process.env.HOST || '127.0.0.1');
}
void bootstrap();
