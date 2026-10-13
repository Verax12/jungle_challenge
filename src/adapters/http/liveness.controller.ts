import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class LivenessController {
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
