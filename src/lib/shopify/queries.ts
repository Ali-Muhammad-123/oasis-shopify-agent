// Admin GraphQL operations used by the agent's read tools.
// Each is validated against the Admin schema: pnpm validate:graphql

const MONEY = 'shopMoney { amount currencyCode }';

export const SHOP_OVERVIEW = /* GraphQL */ `
  query ShopOverview {
    shop { name myshopifyDomain currencyCode ianaTimezone plan { publicDisplayName } }
    orders: ordersCount(limit: null) { count }
    openUnfulfilled: ordersCount(query: "status:open fulfillment_status:unfulfilled", limit: null) { count }
    pendingPayment: ordersCount(query: "financial_status:pending", limit: null) { count }
    products: productsCount(limit: null) { count }
    customers: customersCount(limit: null) { count }
    locations(first: 10) { nodes { id name isActive } }
  }
`;

export const SEARCH_ORDERS = /* GraphQL */ `
  query SearchOrders($first: Int!, $after: String, $query: String, $sortKey: OrderSortKeys, $reverse: Boolean) {
    orders(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt processedAt cancelledAt sourceName tags
        displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { ${MONEY} }
        totalRefundedSet { ${MONEY} }
        discountCodes
        customer { id displayName }
        currentSubtotalLineItemsQuantity
        lineItems(first: 5) { nodes { title quantity sku } }
      }
    }
  }
`;

export const GET_ORDER = /* GraphQL */ `
  query GetOrder($id: ID!) {
    order(id: $id) {
      id name createdAt processedAt cancelledAt cancelReason closedAt note tags sourceName
      displayFinancialStatus displayFulfillmentStatus discountCodes
      customer { id displayName defaultEmailAddress { emailAddress } numberOfOrders }
      subtotalPriceSet { ${MONEY} }
      totalDiscountsSet { ${MONEY} }
      totalShippingPriceSet { ${MONEY} }
      totalTaxSet { ${MONEY} }
      totalPriceSet { ${MONEY} }
      totalRefundedSet { ${MONEY} }
      shippingAddress { name address1 city provinceCode countryCodeV2 zip }
      lineItems(first: 50) {
        nodes {
          title variantTitle quantity sku
          variant { id }
          originalUnitPriceSet { ${MONEY} }
          discountedTotalSet { ${MONEY} }
        }
      }
      transactions(first: 10) { kind status gateway createdAt amountSet { ${MONEY} } }
      fulfillments(first: 5) { status createdAt trackingInfo { company number url } }
    }
  }
`;

export const SEARCH_PRODUCTS = /* GraphQL */ `
  query SearchProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
    products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle status vendor productType tags totalInventory
        variantsCount { count }
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      }
    }
  }
`;

export const GET_PRODUCT = /* GraphQL */ `
  query GetProduct($id: ID!) {
    product(id: $id) {
      id title handle status vendor productType tags createdAt onlineStoreUrl totalInventory
      description(truncateAt: 400)
      featuredMedia { preview { image { url altText } } }
      variants(first: 50) {
        nodes {
          id title sku price compareAtPrice inventoryQuantity inventoryPolicy
          inventoryItem {
            id tracked
            inventoryLevels(first: 5) {
              nodes { location { id name } quantities(names: ["available", "committed", "on_hand"]) { name quantity } }
            }
          }
        }
      }
    }
  }
`;

export const LOW_INVENTORY = /* GraphQL */ `
  query LowInventory($first: Int!, $query: String) {
    productVariants(first: $first, query: $query, sortKey: INVENTORY_QUANTITY) {
      nodes {
        id title sku inventoryQuantity price
        inventoryItem { tracked }
        product { id title status }
      }
    }
  }
`;

export const SEARCH_CUSTOMERS = /* GraphQL */ `
  query SearchCustomers($first: Int!, $after: String, $query: String, $sortKey: CustomerSortKeys, $reverse: Boolean) {
    customers(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id displayName createdAt tags numberOfOrders
        defaultEmailAddress { emailAddress }
        amountSpent { amount currencyCode }
        defaultAddress { city provinceCode countryCodeV2 }
        lastOrder { id name createdAt }
      }
    }
  }
`;

export const GET_CUSTOMER = /* GraphQL */ `
  query GetCustomer($id: ID!) {
    customer(id: $id) {
      id displayName firstName lastName createdAt note tags numberOfOrders
      defaultEmailAddress { emailAddress marketingState }
      defaultPhoneNumber { phoneNumber }
      amountSpent { amount currencyCode }
      defaultAddress { address1 city provinceCode countryCodeV2 zip }
      orders(first: 20, sortKey: CREATED_AT, reverse: true) {
        nodes { id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { ${MONEY} } }
      }
    }
  }
`;

export const LIST_DISCOUNTS = /* GraphQL */ `
  query ListDiscounts($first: Int!, $query: String) {
    discountNodes(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        discount {
          __typename
          ... on DiscountCodeBasic {
            title status startsAt endsAt asyncUsageCount appliesOncePerCustomer
            codes(first: 3) { nodes { code } }
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
          }
          ... on DiscountAutomaticBasic { title status startsAt endsAt }
          ... on DiscountCodeFreeShipping { title status startsAt endsAt codes(first: 3) { nodes { code } } }
        }
      }
    }
  }
`;

export const LIST_DRAFT_ORDERS = /* GraphQL */ `
  query ListDraftOrders($first: Int!, $query: String) {
    draftOrders(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id name status createdAt updatedAt note2 tags
        customer { id displayName }
        totalPriceSet { ${MONEY} }
        order { id name }
        lineItems(first: 5) { nodes { title quantity } }
      }
    }
  }
`;

export const CATALOG_VARIANTS = /* GraphQL */ `
  query CatalogVariants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title sku price compareAtPrice inventoryQuantity
        inventoryItem { tracked unitCost { amount } }
        product { id title status }
      }
    }
  }
`;

export const SHOPIFYQL = /* GraphQL */ `
  query ShopifyQL($query: String!) {
    shopifyqlQuery(query: $query) {
      tableData { columns { name dataType displayName } rows }
      parseErrors
    }
  }
`;

export const PREVIEW_PRODUCTS = /* GraphQL */ `
  query PreviewProducts($first: Int!) {
    shop { name primaryDomain { url } }
    products(first: $first, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
      nodes {
        title handle vendor productType tags
        description(truncateAt: 200)
        featuredMedia { preview { image { url altText } } }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        compareAtPriceRange { minVariantCompareAtPrice { amount } }
      }
    }
  }
`;
