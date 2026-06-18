export const LIST_APPS = `
  query ListApps($first: Int!, $after: String) {
    apps(first: $first, after: $after) {
      edges {
        node {
          id
          name
          appType
          createTime
          active
          draftUrl
          appStoreName
          contactEmail
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_APP = `
  query GetApp($id: ID!) {
    app(id: $id) {
      id
      name
      appType
      createTime
      active
      draftUrl
      appStoreName
      contactEmail
    }
  }
`;

export const GET_INSTALLATIONS = `
  query GetInstallations($appId: ID!, $first: Int!, $after: String) {
    app(id: $appId) {
      installations(first: $first, after: $after) {
        edges {
          node {
            id
            installedAt
            uninstalledAt
            shop {
              name
              myshopifyDomain
              plan { displayName }
            }
            activeSubscriptions {
              name
              test
              status
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export const GET_APP_EVENTS = `
  query GetAppEvents($appId: ID!, $first: Int!, $after: String, $types: [EventType!]) {
    app(id: $appId) {
      events(first: $first, after: $after, types: $types) {
        edges {
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
          endCursor
        }
      }
    }
  }
`;

export const GET_PARTNER_INFO = `
  query GetPartnerInfo {
    currentUserAccount {
      id
      name
      email
      website
      createdAt
    }
  }
`;

export const GET_WEBHOOKS = `
  query GetWebhooks($appId: ID!) {
    app(id: $appId) {
      webhookSubscriptions(first: 50) {
        edges {
          node {
            id
            topic
            format
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
              ... on WebhookEventBridgeEndpoint {
                arn
              }
              ... on WebhookPubSubEndpoint {
                pubSubProject
                pubSubTopic
              }
            }
          }
        }
      }
    }
  }
`;

export const UPDATE_APP = `
  mutation UpdateApp($id: ID!, $appInput: AppInput!) {
    appUpdate(id: $id, app: $appInput) {
      app {
        id
        name
        contactEmail
        draftUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;
