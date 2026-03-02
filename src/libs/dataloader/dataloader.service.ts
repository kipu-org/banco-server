import { Injectable } from '@nestjs/common';
import DataLoader from 'dataloader';

import { EsploraLiquidService } from '../esplora/liquid.service';
import { FiatService } from '../fiat/fiat.service';

type AssetInfo = { name: string; ticker: string; precision: number };

export type DataloaderTypes = {
  priceApiLoader: DataLoader<Date, number | undefined>;
  btcPriceLoader: DataLoader<string, number>;
  assetInfoLoader: DataLoader<string, AssetInfo>;
};

@Injectable()
export class DataloaderService {
  constructor(
    private readonly fiatService: FiatService,
    private readonly esploraLiquid: EsploraLiquidService,
  ) {}

  createLoaders(): DataloaderTypes {
    const priceApiLoader = new DataLoader<Date, number | undefined>(
      async (dates: readonly Date[]) =>
        this.fiatService.getChartPrices(dates as Date[]),
    );

    const btcPriceLoader = new DataLoader<string, number>(async (keys) => {
      const price = await this.fiatService.getLatestBtcPrice();
      return keys.map(() => price);
    });

    const assetInfoLoader = new DataLoader<string, AssetInfo>(
      async (assetIds: readonly string[]) =>
        Promise.all(assetIds.map((id) => this.esploraLiquid.getAssetInfo(id))),
    );

    return {
      priceApiLoader,
      btcPriceLoader,
      assetInfoLoader,
    };
  }
}
