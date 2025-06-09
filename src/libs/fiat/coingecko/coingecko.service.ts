import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomLogger, Logger } from 'src/libs/logging';
import { RedisService } from 'src/libs/redis/redis.service';
import { fetch } from 'undici';

import {
  marketChart,
  ONE_HOUR_IN_SECONDS,
  simplePrice,
} from './coingecko.types';

@Injectable()
export class CoingeckoApiService {
  private readonly url: string;
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly cache: RedisService,
    @Logger(CoingeckoApiService.name) private readonly logger: CustomLogger,
  ) {
    this.url = this.config.getOrThrow<string>('fiat.coingecko.url');
    this.apiKey = this.config.getOrThrow<string>('fiat.coingecko.apikey');
  }

  async fetchBtcPrice(): Promise<number> {
    try {
      const result = await this.fetch(
        `simple/price?ids=bitcoin&vs_currencies=usd`,
      );
      const parsed = simplePrice.parse(result);

      return parsed.bitcoin.usd;
    } catch (error) {
      this.logger.error('Error getting BTC price through Coingecko API', {
        error,
      });
      throw new Error('Error getting BTC price!');
    }
  }

  async getLatestBtcPrice(): Promise<number> {
    const key = `Coingecko-getLatestBtcPrice`;
    const cached = await this.cache.get<number>(key);

    if (cached) return cached;

    const price = await this.fetchBtcPrice();

    if (!price) throw new Error('Error fetching BTC price!');
    await this.cache.set(key, price, { ttl: ONE_HOUR_IN_SECONDS });

    return price;
  }

  async getChartData(days = 7, interval = 'daily') {
    try {
      const result = await this.fetch(
        `coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=${interval}&precision=0`,
      );

      const { prices } = marketChart.parse(result);

      return prices;
    } catch (error) {
      this.logger.error('Error getting btc chart data', { error });
      return undefined;
    }
  }

  private async fetch(endpoint: string): Promise<any> {
    const res = await fetch(`${this.url}/${endpoint}`, {
      headers: { 'x-cg-pro-api-key': this.apiKey },
    });

    return res.json();
  }
}
