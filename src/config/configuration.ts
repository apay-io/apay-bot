import { Networks } from 'stellar-sdk';
import * as fs from 'fs';

export default () => ({
  markets: [
    {
      account: 'GDO2OU2OLMAVOLYIUUD3S62FKQ43FRK6QZ4EOGAG6AUE4JXRHD5P5R7K',
      base: { asset_type: 'native' },
      asset: { asset_type: 'credit_alphanum4', asset_code: 'SLT', asset_issuer: 'GCKA6K5PCQ6PNF5RQBF7PQDJWRHO6UOGFMRLK3DYHDOI244V47XKQ4GP' },
    },
  ],
  stellar: {
    horizonUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
  },
  redis: process.env.REDIS || {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASS || '',
    keepAlive: 15000,
  },
});
