// ── Auth ─────────────────────────────────────────────────────
export const PUBLIC_API_VERSIONS = `{
  publicApiVersions {
    handle
    displayName
    supported
  }
}`;

// ── Apps ─────────────────────────────────────────────────────
export const GET_APP = `
  query GetApp($id: ID!) {
    app(id: $id) {
      id
      name
      apiKey
    }
  }
`;

// Cursor-based: after = cursor from last edge (NOT pageInfo.endCursor)
// PageInfo only exposes hasNextPage + hasPreviousPage (no endCursor)
export const GET_APP_EVENTS = `
  query GetAppEvents(
    $id: ID!
    $after: String
    $types: [AppEventType!]
    $occurredAtMin: DateTime
    $occurredAtMax: DateTime
  ) {
    app(id: $id) {
      events(
        first: 50
        after: $after
        types: $types
        occurredAtMin: $occurredAtMin
        occurredAtMax: $occurredAtMax
      ) {
        edges {
          cursor
          node {
            type
            occurredAt
            shop {
              name
              myshopifyDomain
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
        }
      }
    }
  }
`;

// ── Transactions ─────────────────────────────────────────────
export const LIST_TRANSACTIONS = `
  query ListTransactions($first: Int!, $types: [TransactionType!]) {
    transactions(first: $first, types: $types) {
      edges {
        node {
          id
          createdAt
          __typename
          ... on AppSubscriptionSale {
            netAmount { amount currencyCode }
            grossAmount { amount currencyCode }
            shopifyFee { amount currencyCode }
            app { name apiKey }
            shop { name myshopifyDomain }
          }
          ... on AppOneTimeSale {
            netAmount { amount currencyCode }
            grossAmount { amount currencyCode }
            shopifyFee { amount currencyCode }
            app { name apiKey }
            shop { name myshopifyDomain }
          }
          ... on AppUsageSale {
            netAmount { amount currencyCode }
            grossAmount { amount currencyCode }
            shopifyFee { amount currencyCode }
            app { name apiKey }
            shop { name myshopifyDomain }
          }
          ... on AppSaleAdjustment {
            netAmount { amount currencyCode }
            grossAmount { amount currencyCode }
            shopifyFee { amount currencyCode }
            app { name apiKey }
            shop { name myshopifyDomain }
          }
          ... on AppSaleCredit {
            netAmount { amount currencyCode }
            grossAmount { amount currencyCode }
            app { name apiKey }
            shop { name myshopifyDomain }
          }
        }
      }
    }
  }
`;

export const GET_TRANSACTION = `
  query GetTransaction($id: ID!) {
    transaction(id: $id) {
      id
      createdAt
      __typename
      ... on AppSubscriptionSale {
        netAmount { amount currencyCode }
        grossAmount { amount currencyCode }
        shopifyFee { amount currencyCode }
        app { name apiKey }
        shop { name myshopifyDomain }
      }
      ... on AppOneTimeSale {
        netAmount { amount currencyCode }
        grossAmount { amount currencyCode }
        shopifyFee { amount currencyCode }
        app { name apiKey }
        shop { name myshopifyDomain }
      }
      ... on AppUsageSale {
        netAmount { amount currencyCode }
        grossAmount { amount currencyCode }
        shopifyFee { amount currencyCode }
        app { name apiKey }
        shop { name myshopifyDomain }
      }
      ... on AppSaleAdjustment {
        netAmount { amount currencyCode }
        grossAmount { amount currencyCode }
        shopifyFee { amount currencyCode }
        app { name apiKey }
        shop { name myshopifyDomain }
      }
      ... on AppSaleCredit {
        netAmount { amount currencyCode }
        grossAmount { amount currencyCode }
        app { name apiKey }
        shop { name myshopifyDomain }
      }
    }
  }
`;
