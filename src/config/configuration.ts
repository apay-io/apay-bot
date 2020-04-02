import { Networks } from 'stellar-sdk';
import * as fs from 'fs';

export default () => ({
  markets: fs.readFileSync('../../markets.json'),
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
