import { Injectable } from '@nestjs/common';
import DataLoader from 'dataloader';

import { FiatService } from '../fiat/fiat.service';

export type DataloaderTypes = {
  priceApiLoader: DataLoader<Date, number | undefined>;
  btcPriceLoader: DataLoader<string, number>;
};

@Injectable()
export class DataloaderService {
  constructor(private readonly fiatService: FiatService) {}

  createLoaders(): DataloaderTypes {
    const priceApiLoader = new DataLoader<Date, number | undefined>(
      async (dates: readonly Date[]) =>
        this.fiatService.getChartPrices(dates as Date[]),
    );

    const btcPriceLoader = new DataLoader<string, number>(async (keys) => {
      const price = await this.fiatService.getLatestBtcPrice();
      return keys.map(() => price);
    });

    return {
      priceApiLoader,
      btcPriceLoader,
    };
  }
}
