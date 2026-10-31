import { Module } from '@nestjs/common';
import { FulfillmentService } from './fulfillment.service.js';
import { FulfillmentController } from './fulfillment.controller.js';
import { OrdersRepositoryModule } from '../orders/orders.repository.js';
import { FulfillmentRepositoryModule } from '../fulfillment/fulfillment.repository.js';
import { AccountsRepositoryModule } from '../accounts/accounts.repository.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RewardsModule } from '../rewards/rewards.module.js';
import { CatalogRepositoryModule } from '../catalog/catalog.repository.js';
import { ReturnsRepositoryModule } from '../returns/returns.repository.js';
import { CapacityReconcilerModule } from '../settlement/capacity.reconciler.js';
@Module({
  imports: [
    OrdersRepositoryModule,
    FulfillmentRepositoryModule,
    AccountsRepositoryModule,
    AccountsModule,
    RewardsModule,
    CatalogRepositoryModule,
    ReturnsRepositoryModule,
    CapacityReconcilerModule,
  ],
  controllers: [FulfillmentController],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
