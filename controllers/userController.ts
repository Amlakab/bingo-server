// controllers/userController.ts
import { Request, Response } from 'express';
import User from '../models/User';
import { successResponse, errorResponse } from '../utils/helpers';

export const updateWallet = async (req: Request, res: Response) => {
  try {
    const { userId, amount } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Check if the user has sufficient balance if amount is negative
    if (amount < 0 && user.wallet < Math.abs(amount)) {
      return errorResponse(res, 'Insufficient wallet balance', 400);
    }

    user.wallet += amount;
    await user.save();

    successResponse(res, { wallet: user.wallet }, 'Wallet updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const updateEarnings = async (req: Request, res: Response) => {
  try {
    const { userId, amount } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Get current date and reset daily/weekly earnings if needed
    const now = new Date();
    const lastUpdated = new Date(user.updatedAt);
    
    // Reset daily earnings if it's a new day
    if (lastUpdated.getDate() !== now.getDate()) {
      user.dailyEarnings = 0;
    }
    
    // Reset weekly earnings if it's a new week
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const lastUpdateStartOfWeek = new Date(lastUpdated);
    lastUpdateStartOfWeek.setDate(lastUpdated.getDate() - lastUpdated.getDay());
    
    if (startOfWeek.getTime() !== lastUpdateStartOfWeek.getTime()) {
      user.weeklyEarnings = 0;
    }

    // Update earnings
    user.dailyEarnings += amount;
    user.weeklyEarnings += amount;
    user.totalEarnings += amount;
    user.wallet += amount;
    
    await user.save();

    successResponse(res, { 
      wallet: user.wallet,
      dailyEarnings: user.dailyEarnings,
      weeklyEarnings: user.weeklyEarnings,
      totalEarnings: user.totalEarnings
    }, 'Earnings updated successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};

export const getUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    successResponse(res, user, 'User retrieved successfully');
  } catch (error: any) {
    errorResponse(res, error.message, 500);
  }
};