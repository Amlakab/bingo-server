import express from 'express';
import {
  getGames,
  getGame,
  getUserCards,
  purchaseCard,
  getGameHistory,
} from '../controllers/gameController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.get('/', authenticate, getGames);
router.get('/history', authenticate, getGameHistory);
router.get('/:id', authenticate, getGame);
router.get('/:id/cards', authenticate, getUserCards);
router.post('/:id/purchase', authenticate, purchaseCard);

export default router;