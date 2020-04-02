export type AssetType = 'native' | 'credit_alphanum4' | 'credit_alphanum12';

export interface AssetInterface {
  asset_type: AssetType;

  asset_code?: string;

  asset_issuer?: string;
}
