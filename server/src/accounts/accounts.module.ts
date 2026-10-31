import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';
import { AccountsController } from './accounts.controller.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { AccountsRepositoryModule } from '../accounts/accounts.repository.js';
import { RewardsModule } from '../rewards/rewards.module.js';
import { CreditsRepositoryModule } from '../credits/credits.repository.js';
import { RewardsRepositoryModule } from '../rewards/rewards.repository.js';
import { ReturnsRepositoryModule } from '../returns/returns.repository.js';
import { FulfillmentRepositoryModule } from '../fulfillment/fulfillment.repository.js';
import { CapacityReconcilerModule } from '../settlement/capacity.reconciler.js';
@Module({
  imports: [
    CustomersRepositoryModule,
    AccountsRepositoryModule,
    RewardsModule,
    CreditsRepositoryModule,
    RewardsRepositoryModule,
    ReturnsRepositoryModule,
    FulfillmentRepositoryModule,
    CapacityReconcilerModule,
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
