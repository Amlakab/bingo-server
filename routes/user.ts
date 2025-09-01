// routes/user.ts
import express from 'express';
import { updateWallet, updateEarnings, getUser } from '../controllers/userController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.put('/wallet', authenticate, updateWallet);
router.put('/earnings', authenticate, updateEarnings);
router.get('/:userId', authenticate, getUser);

export default router;