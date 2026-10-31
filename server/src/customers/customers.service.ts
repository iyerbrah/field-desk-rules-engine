import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { User } from '@crm/shared';
import type { Customer } from '@crm/shared/crm';
import { CustomersRepository } from '../customers/customers.repository.js';
import { DatabaseService } from '../database/database.service.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import { authorize, useCustomer, fail } from '../common/domain.js';

@Injectable()
export class CustomersService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly database: DatabaseService,
  ) {}
  updateCustomer(c: Context, p: Payload<'UPDATE_CUSTOMER'>) {
    authorize(c, 'ADMIN', 'SALES', 'ACCOUNTS');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    if (this.customersRepository.findOtherByCode(p.code, p.customerId))
      fail('CUSTOMER_CODE_EXISTS', 'Another customer already uses this code');
    this.customersRepository.updateCustomer(c, p.customerId, {
      name: p.name,
      code: p.code,
    });
  }
  createCustomer(user: User, input: { name: string; code: string }): Customer {
    if (!['ADMIN', 'SALES', 'ACCOUNTS'].includes(user.role))
      throw new ForbiddenException('This role cannot create customers');
    return this.database.db.transaction(
      () => {
        const c: Context = {
          id: randomUUID(),
          actor: user,
          requester: user,
          now: new Date().toISOString(),
          customerId: randomUUID(),
          touched: new Set(),
          answers: {},
          effects: [],
          references: {},
        };
        if (this.customersRepository.findByCode(input.code))
          throw new ConflictException('Customer code already exists');
        this.customersRepository.insertCustomer(c, {
          id: c.customerId,
          name: input.name,
          code: input.code,
          version: 0,
        });
        return this.customersRepository.findById(c.customerId)!;
      },
      { behavior: 'immediate' },
    );
  }
  findById(id: string) {
    const customer = this.customersRepository.findById(id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
