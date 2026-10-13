import { Module } from '@nestjs/common';
import { LivenessController } from '../adapters/http/liveness.controller.js';

@Module({ controllers: [LivenessController] })
export class AppModule {}
