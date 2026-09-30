import { Router } from 'express';

import { getHealth } from '../controllers/health.controller.ts';

export const healthRouter = Router();

healthRouter.get('/health', getHealth);
