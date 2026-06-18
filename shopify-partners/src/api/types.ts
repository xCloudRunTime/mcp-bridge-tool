// ── Shared primitives ─────────────────────────────────────────
export interface MoneyAmount {
  amount: string;        // decimal string e.g. "29.00"
  currencyCode: string;  // e.g. "USD"
}

export interface AppRef {
  name: string;
  apiKey: string;   // Client ID shown in Partners Dashboard
}

export interface Shop {
  name: string;
  myshopifyDomain: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Edge<T> {
  cursor: string;
  node: T;
}

export interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
}

// ── App ───────────────────────────────────────────────────────
export interface ShopifyApp {
  id: string;      // GID  e.g. "gid://partners/App/12345"
  name: string;
  apiKey: string;  // Client ID
}

// ── App Events ────────────────────────────────────────────────
export type AppEventType =
  | "RELATIONSHIP_INSTALLED"
  | "RELATIONSHIP_UNINSTALLED"
  | "RELATIONSHIP_REACTIVATED"
  | "RELATIONSHIP_DEACTIVATED";

export interface AppEvent {
  type: AppEventType | string;
  occurredAt: string;   // ISO-8601
  shop: Shop | null;
}

export interface GetAppEventsOptions {
  types?: string[];
  from?: string;   // ISO-8601 DateTime
  to?: string;     // ISO-8601 DateTime
  limit?: number;
}

// ── Transactions ─────────────────────────────────────────────
export type TransactionType =
  | "APP_SUBSCRIPTION_SALE"
  | "APP_ONE_TIME_SALE"
  | "APP_USAGE_SALE"
  | "APP_SALE_ADJUSTMENT"
  | "APP_SALE_CREDIT";

interface TransactionBase {
  id: string;
  createdAt: string;
  __typename: string;
  netAmount: MoneyAmount;
  grossAmount: MoneyAmount;
  app: AppRef | null;
  shop: Shop | null;
}

export interface AppSubscriptionSale extends TransactionBase {
  __typename: "AppSubscriptionSale";
  shopifyFee: MoneyAmount;
}

export interface AppOneTimeSale extends TransactionBase {
  __typename: "AppOneTimeSale";
  shopifyFee: MoneyAmount;
}

export interface AppUsageSale extends TransactionBase {
  __typename: "AppUsageSale";
  shopifyFee: MoneyAmount;
}

export interface AppSaleAdjustment extends TransactionBase {
  __typename: "AppSaleAdjustment";
  shopifyFee: MoneyAmount;
}

export interface AppSaleCredit extends TransactionBase {
  __typename: "AppSaleCredit";
}

export type Transaction =
  | AppSubscriptionSale
  | AppOneTimeSale
  | AppUsageSale
  | AppSaleAdjustment
  | AppSaleCredit;

export interface ListTransactionsOptions {
  first?: number;
  types?: TransactionType[];
}

// ── Auth ─────────────────────────────────────────────────────
export interface ApiVersion {
  handle: string;
  displayName: string;
  supported: boolean;
}
