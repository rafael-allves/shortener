import { create, get, getAll, update, deleteUrl } from './url.controller.ts';
import { RateLimit } from '../../config/rateLimit.ts'
import express from "express";
import {asyncHandler} from "../../utils/errorHandler.ts";

const urlRateLimiter = new RateLimit({
    limit: 50,
    windowMs: 1_000
});

const router = express.Router();

router.post('/', urlRateLimiter.middleware(), create);
router.get('/', getAll);
router.get('/:shortCode', get);
router.put('/:shortCode', urlRateLimiter.middleware(), update);
router.delete('/:shortCode', urlRateLimiter.middleware(), deleteUrl);

export default router;