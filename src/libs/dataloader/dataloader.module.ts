import { Module } from '@nestjs/common';

import { EsploraServiceModule } from '../esplora/esplora.module';
import { FiatModule } from '../fiat/fiat.module';
import { DataloaderService } from './dataloader.service';

@Module({
  imports: [FiatModule, EsploraServiceModule],
  providers: [DataloaderService],
  exports: [DataloaderService],
})
export class DataloaderModule {}
