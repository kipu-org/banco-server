import { Update, Wollet } from 'lwk_node';

export type GetUpdatedWalletAutoType = {
  getUpdates: {
    deltaStrings: string[];
    deltas: Update[];
  };
  getWolletWithUpdates: Wollet;
  updateWollet: Wollet;
};

export type LiquidRedisCache = string[];
