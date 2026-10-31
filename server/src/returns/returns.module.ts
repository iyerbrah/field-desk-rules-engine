import { Module } from '@nestjs/common';
import { ReturnsService } from './returns.service.js';
import { ReturnsController } from './returns.controller.js';
import { OrdersRepositoryModule } from '../orders/orders.repository.js';
import { FulfillmentRepositoryModule } from '../fulfillment/fulfillment.repository.js';
import { ReturnsRepositoryModule } from '../returns/returns.repository.js';
import { AccountsRepositoryModule } from '../accounts/accounts.repository.js';
import { CreditsRepositoryModule } from '../credits/credits.repository.js';
import { RewardsRepositoryModule } from '../rewards/rewards.repository.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RewardsModule } from '../rewards/rewards.module.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { CapacityReconcilerModule } from '../settlement/capacity.reconciler.js';
@Module({
  imports: [
    OrdersRepositoryModule,
    FulfillmentRepositoryModule,
    ReturnsRepositoryModule,
    AccountsRepositoryModule,
    CreditsRepositoryModule,
    RewardsRepositoryModule,
    AccountsModule,
    RewardsModule,
    CustomersRepositoryModule,
    CapacityReconcilerModule,
  ],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
