import { Request, Response } from 'express';
import User from '../models/User';
import Transaction from '../models/Transaction';
import { chapa, generateTxRef } from '../config/chapa';
import { successResponse, errorResponse } from '../utils/helpers';

export const getWallet = async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user!._id).select('wallet dailyEarnings weeklyEarnings totalEarnings');
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    
    successResponse(res, user, 'Wallet retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const { type, limit = 20, page = 1 } = req.query;
    const filter: any = { userId: req.user!._id };
    
    if (type) filter.type = type;
    
    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));
    
    const total = await Transaction.countDocuments(filter);
    
    successResponse(res, {
      transactions,
      total,
      page: parseInt(page as string),
      pages: Math.ceil(total / parseInt(limit as string))
    }, 'Transactions retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const initializeDeposit = async (req: Request, res: Response) => {
  try {
    const { amount, currency = 'ETB' } = req.body;
    const userId = req.user!._id;
    const user = await User.findById(userId);
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    
    const tx_ref = generateTxRef(userId.toString(), 'deposit');
    
    const response = await chapa.initialize({
      amount: amount.toString(),
      currency,
      email: `${user.phone}@bingo.com`,
      first_name: 'User',
      last_name: user.phone,
      phone_number: user.phone,
      tx_ref,
      callback_url: `${process.env.CLIENT_URL}/user/wallet?success=true`,
      return_url: `${process.env.CLIENT_URL}/user/wallet`,
      customization: {
        title: 'Bingo Platform Deposit',
        description: `Deposit of ${amount} ${currency}`,
      },
    });
    
    // Create pending transaction
    const transaction = new Transaction({
      userId,
      type: 'deposit',
      amount,
      status: 'pending',
      reference: tx_ref,
      description: `Deposit of ${amount} ${currency}`,
    });
    
    await transaction.save();
    
    successResponse(res, { checkout_url: response.data.checkout_url }, 'Deposit initialized successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const verifyDeposit = async (req: Request, res: Response) => {
  try {
    const { tx_ref } = req.params;
    
    const response = await chapa.verify(tx_ref);
    
    if (response.status === 'success') {
      // Find transaction
      const transaction = await Transaction.findOne({ reference: tx_ref });
      
      if (transaction && transaction.status === 'pending') {
        // Update transaction status
        transaction.status = 'completed';
        await transaction.save();
        
        // Update user wallet
        const user = await User.findById(transaction.userId);
        if (user) {
          user.wallet += transaction.amount;
          await user.save();
        }
      }
      
      successResponse(res, { status: 'success' }, 'Deposit verified successfully');
    } else {
      errorResponse(res, 'Deposit verification failed', 400);
    }
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const handleWebhook = async (req: Request, res: Response) => {
  try {
    // Verify webhook signature (implementation depends on Chapa's webhook format)
    // For now, we'll assume it's valid in development
    
    const { tx_ref, status, amount } = req.body;
    
    if (status === 'success') {
      // Find transaction
      const transaction = await Transaction.findOne({ reference: tx_ref });
      
      if (transaction && transaction.status === 'pending') {
        // Update transaction status
        transaction.status = 'completed';
        await transaction.save();
        
        // Update user wallet
        const user = await User.findById(transaction.userId);
        if (user) {
          user.wallet += transaction.amount;
          await user.save();
        }
      }
    }
    
    res.status(200).send('Webhook received');
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook processing failed');
  }
};

export const requestWithdrawal = async (req: Request, res: Response) => {
  try {
    const { amount, accountNumber, bankName } = req.body;
    const userId = req.user!._id;
    
    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    
    if (user.wallet < amount) {
      return errorResponse(res, 'Insufficient balance', 400);
    }
    
    if (amount < 50) {
      return errorResponse(res, 'Minimum withdrawal amount is 50 ETB', 400);
    }
    
    // Create withdrawal request
    const transaction = new Transaction({
      userId,
      type: 'withdrawal',
      amount,
      status: 'pending',
      reference: `WTH-${Date.now()}-${userId}`,
      description: `Withdrawal request to ${bankName} account ${accountNumber}`,
      metadata: {
        accountNumber,
        bankName,
      }
    });
    
    await transaction.save();
    
    // Reserve the amount (deduct from available balance)
    user.wallet -= amount;
    await user.save();
    
    successResponse(res, transaction, 'Withdrawal request submitted successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getWinnings = async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id;
    
    const winnings = await Transaction.find({
      userId,
      type: 'winning',
      status: 'completed'
    }).sort({ createdAt: -1 }).limit(20);
    
    successResponse(res, winnings, 'Winnings retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};