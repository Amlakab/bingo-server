import express from 'express';
import {
  getWallet,
  getTransactions,
  initializeDeposit,
  verifyDeposit,
  handleWebhook,
  requestWithdrawal,
  getWinnings,
} from '../controllers/walletController';
import { authenticate } from '../middleware/auth';
import { validateDeposit, validateWithdrawal } from '../middleware/validation';
import { paymentLimiter } from '../middleware/rateLimit';

const router = express.Router();

router.get('/', authenticate, getWallet);
router.get('/transactions', authenticate, getTransactions);
router.get('/winnings', authenticate, getWinnings);
router.post('/deposit', paymentLimiter, authenticate, validateDeposit, initializeDeposit);
router.get('/deposit/verify/:tx_ref', authenticate, verifyDeposit);
router.post('/withdraw', paymentLimiter, authenticate, validateWithdrawal, requestWithdrawal);
router.post('/webhook', handleWebhook);

export default router;