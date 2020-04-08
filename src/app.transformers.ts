import { ValueTransformer } from 'typeorm';
import { BigNumber } from 'bignumber.js';

export class TrimStringTransformer implements ValueTransformer {
  to(value?: string): string {
    return (value || '').trim();
  }

  from(value?: string): string {
    return (value || '').trim();
  }
}

export class BigNumberToStringTransformer implements ValueTransformer {
  to(value: BigNumber): string {
    return value && !value.isNaN() ? value.toString() : null;
  }

  from(value: string): BigNumber {
    return new BigNumber(value);
  }
}
