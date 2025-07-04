import { Injectable } from '@nestjs/common';
import { differenceInDays } from 'date-fns';
import { ONE_HOUR_IN_SECONDS } from 'src/libs/fiat/coingecko/coingecko.types';
import { getSHA256Hash } from 'src/utils/crypto/crypto';

import { RedisService } from '../redis/redis.service';
import { CoingeckoApiService } from './coingecko/coingecko.service';
import { mapDayPricesResult } from './fiat.helpers';

@Injectable()
export class FiatService {
  constructor(
    private coingecko: CoingeckoApiService,
    private redis: RedisService,
  ) {}

  async getLatestBtcPrice(): Promise<number> {
    const key = `FiatService-getLatestBtcPrice`;
    const cached = await this.redis.get<number>(key);
    if (cached) return cached;

    const price = await this.coingecko.fetchBtcPrice();

    if (!price) throw new Error('Error fetching BTC price!');
    await this.redis.set(key, price, { ttl: ONE_HOUR_IN_SECONDS });

    return price;
  }

  async getChartPrices(dates: Date[]): Promise<(number | undefined)[]> {
    // we need a copy of the input array since the dataloader depends in the indices
    const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());

    const earliestDate = sortedDates[0];

    const key = `getDayPrice-${getSHA256Hash(sortedDates.toString())}`;

    const cached = await this.redis.get<number[][]>(key);
    if (cached) return mapDayPricesResult(dates, cached);

    // +1 to add today
    const daysToQuery = differenceInDays(new Date(), earliestDate) + 1;

    const chartData = await this.coingecko.getChartData(daysToQuery);
    if (!chartData) return [];

    await this.redis.set(key, chartData, { ttl: 60 * 60 * 24 });

    return mapDayPricesResult(dates, chartData);
  }
}
