import Chapa from 'chapa-node';

export const chapa = new Chapa(process.env.CHAPA_SECRET_KEY!);

export const generateTxRef = (userId: string, type: string) => {
  return `${type}-${Date.now()}-${userId}`;
};
